'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { generateSlug } from '@/lib/utils/slug';
import { validateTitle, validateBody, validateLength } from '@/lib/utils/validation';
import { writeAuditLog } from '@/lib/audit/log';
import { notifyUser } from '@/lib/vhu/notify';
import { analyzeTicketWithAi, AI_PRIORITY_TO_DB } from '@/lib/ai/vhu-analyze';
import { sendUrgentTicketWebhook } from '@/lib/webhook/telegram';
import { canTransition, STATUS_LABELS_VI, type AppRole, type VhuTicketStatus } from '@/lib/vhu/types';

export type VhuActionState = {
  error?: string;
  fieldErrors?: Record<string, string>;
  ticketId?: number;
};

type ViewerContext = {
  supabase: Awaited<ReturnType<typeof createServerClient>>;
  userId: string;
  email: string;
  role: AppRole;
  departmentId: string | null;
  displayName: string;
};

async function requireViewer(): Promise<ViewerContext> {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, role, department_id, display_name, is_blocked')
    .eq('id', user.id)
    .single();

  if (!profile) throw new Error('Không tìm thấy hồ sơ người dùng.');
  if (profile.is_blocked) throw new Error('Tài khoản của bạn đã bị khóa.');

  return {
    supabase,
    userId: user.id,
    email: profile.email,
    role: profile.role as AppRole,
    departmentId: profile.department_id,
    displayName: profile.display_name ?? profile.email,
  };
}

// ============================================================
// 1. Create ticket (§19 of spec)
// ============================================================

export async function createVhuTicket(
  _prev: VhuActionState,
  formData: FormData,
): Promise<VhuActionState> {
  const viewer = await requireViewer();

  const title = (formData.get('title') as string)?.trim() ?? '';
  const description = (formData.get('description') as string)?.trim() ?? '';
  const location = (formData.get('location') as string)?.trim() || null;
  const deviceName = (formData.get('device_name') as string)?.trim() || null;
  const categoryId = (formData.get('category_id') as string) || null;
  const contactPhone = (formData.get('contact_phone') as string)?.trim() || null;
  const desiredResolutionAt = (formData.get('desired_resolution_at') as string) || null;
  const urgencyRaw = (formData.get('urgency') as string) || 'medium';
  const urgency = (['low', 'medium', 'high', 'critical'] as const).includes(urgencyRaw as never)
    ? urgencyRaw
    : 'medium';

  const fieldErrors: Record<string, string> = {};
  const titleError = validateTitle(title) ?? validateLength(title, 'Tiêu đề', 300, true);
  if (title.trim().length > 0 && title.trim().length < 5) fieldErrors.title = 'Tiêu đề phải có tối thiểu 5 ký tự.';
  else if (titleError) fieldErrors.title = 'Vui lòng nhập tiêu đề (tối thiểu 5 ký tự).';

  if (description.length > 0 && description.length < 20) fieldErrors.description = 'Nội dung chi tiết phải có tối thiểu 20 ký tự.';
  else if (!description) fieldErrors.description = 'Vui lòng nhập nội dung chi tiết yêu cầu.';
  const bodyLenError = validateBody(description);
  if (bodyLenError && description.length > 20) fieldErrors.description = 'Nội dung quá dài.';

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  // Rate limit: max 20 tickets / 24h per requester (defense against spam,
  // separate from the inherited ticket_creation_rate_limit which covers
  // legacy tickets too).
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await viewer.supabase
    .from('tickets')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', viewer.userId)
    .gte('created_at', since);
  if ((count ?? 0) >= 20) {
    return { error: 'Bạn đã tạo quá nhiều yêu cầu trong 24 giờ qua. Vui lòng thử lại sau.' };
  }

  const { data: defaultType } = await viewer.supabase
    .from('ticket_types')
    .select('id')
    .eq('is_default', true)
    .single();

  const slug = `${generateSlug(title)}-${Date.now().toString(36)}`;

  const { data: ticket, error } = await viewer.supabase
    .from('tickets')
    .insert({
      title,
      slug,
      type_id: defaultType?.id,
      creator_id: viewer.userId,
      category_id: categoryId,
      location,
      device_name: deviceName,
      contact_phone: contactPhone,
      desired_resolution_at: desiredResolutionAt || null,
      urgency,
      is_private: true,
      vhu_status: 'NEW',
      ai_status: 'PENDING',
    })
    .select('id, ticket_code, category_id')
    .single();

  if (error || !ticket) {
    console.error('[vhu] create ticket failed:', error?.message);
    return { error: 'Không thể tạo yêu cầu. Vui lòng thử lại.' };
  }

  const { data: post } = await viewer.supabase
    .from('posts')
    .insert({
      ticket_id: ticket.id,
      author_id: viewer.userId,
      body: description,
      is_original: true,
      post_type: 'post',
    })
    .select('id')
    .single();

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'create_ticket',
    entityType: 'tickets',
    entityId: String(ticket.id),
    ticketId: ticket.id,
    newData: { title, ticket_code: ticket.ticket_code, category_id: categoryId, location },
  });

  // AI analysis runs synchronously (best-effort — never blocks ticket
  // creation on failure) so the requester sees results immediately.
  await runAiAnalysisForTicket(ticket.id, { skipPermissionCheck: true });

  void post;
  revalidatePath('/tickets');
  redirect(`/tickets/${ticket.id}/${slug}`);
}

// ============================================================
// 2. AI analysis (§9 of spec)
// ============================================================

async function runAiAnalysisForTicket(
  ticketId: number,
  opts: { skipPermissionCheck?: boolean } = {},
): Promise<void> {
  const service = createServiceRoleClient();

  const { data: ticket } = await service
    .from('tickets')
    .select('id, ticket_code, title, location, device_name, category_id, priority_adjusted_by, requester:profiles!tickets_creator_id_fkey(display_name)')
    .eq('id', ticketId)
    .single();
  if (!ticket) return;

  const { data: originalPost } = await service
    .from('posts')
    .select('body')
    .eq('ticket_id', ticketId)
    .eq('is_original', true)
    .single();

  await service.from('tickets').update({ ai_status: 'PROCESSING' }).eq('id', ticketId);

  const result = await analyzeTicketWithAi({
    title: ticket.title,
    description: originalPost?.body ?? ticket.title,
    location: ticket.location,
    deviceName: ticket.device_name,
  });

  if (!result.ok) {
    await service.from('tickets').update({ ai_status: 'FAILED', ai_error: result.error.slice(0, 500) }).eq('id', ticketId);
    return;
  }

  const dbPriority = AI_PRIORITY_TO_DB[result.data.suggestedPriority];

  const { data: matchedCategory } = await service
    .from('categories')
    .select('id, default_department_id')
    .eq('name', result.data.category)
    .maybeSingle();

  const updates: Record<string, unknown> = {
    ai_summary: result.data.summary,
    ai_category: result.data.category,
    ai_priority: dbPriority,
    ai_confidence: result.data.confidence,
    ai_reason: result.data.reason,
    ai_suggested_actions: result.data.suggestedActions,
    ai_suggested_department: result.data.suggestedDepartment ?? null,
    ai_status: 'COMPLETED',
    ai_error: null,
    vhu_status: 'AI_ANALYZED',
  };

  // Only auto-fill category/priority if a human has not already overridden them.
  if (!ticket.category_id && matchedCategory) {
    updates.category_id = matchedCategory.id;
    updates.department_id = matchedCategory.default_department_id;
  }
  if (!ticket.priority_adjusted_by) {
    updates.priority = dbPriority;
  }

  await service.from('tickets').update(updates).eq('id', ticketId);

  await writeAuditLog({
    actor: { id: null, email: 'ai-service', role: 'system' },
    action: 'run_ai',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
    newData: { ...result.data, simulated: result.simulated },
  });

  if (dbPriority === 'critical' && !ticket.priority_adjusted_by) {
    await triggerUrgentWebhook(ticketId);
  }

  if (!opts.skipPermissionCheck) revalidatePath(`/tickets/${ticketId}`);
}

export async function rerunAiAnalysis(ticketId: number): Promise<VhuActionState> {
  const viewer = await requireViewer();
  if (viewer.role !== 'manager' && viewer.role !== 'admin') {
    return { error: 'Chỉ Quản lý hoặc Quản trị viên được chạy lại AI.' };
  }
  await runAiAnalysisForTicket(ticketId);
  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'rerun_ai',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
  });
  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

async function triggerUrgentWebhook(ticketId: number): Promise<void> {
  const service = createServiceRoleClient();
  const { data: ticket } = await service
    .from('tickets')
    .select('id, ticket_code, title, location, created_at, vhu_status, category:categories(name), requester:profiles!tickets_creator_id_fkey(display_name)')
    .eq('id', ticketId)
    .single();
  if (!ticket) return;

  const category = Array.isArray(ticket.category) ? ticket.category[0] : ticket.category;
  const requester = Array.isArray(ticket.requester) ? ticket.requester[0] : ticket.requester;

  await sendUrgentTicketWebhook({
    ticketId: ticket.id,
    ticketCode: ticket.ticket_code,
    title: ticket.title,
    categoryName: (category as { name: string } | null)?.name ?? null,
    requesterName: (requester as { display_name: string | null } | null)?.display_name ?? null,
    location: ticket.location,
    createdAt: ticket.created_at,
    statusLabel: STATUS_LABELS_VI[ticket.vhu_status as VhuTicketStatus] ?? ticket.vhu_status,
  });
}

// ============================================================
// 3. Status transitions (§6 of spec)
// ============================================================

export async function changeVhuTicketStatus(
  ticketId: number,
  toStatus: VhuTicketStatus,
  note?: string,
): Promise<VhuActionState> {
  const viewer = await requireViewer();

  const { data: ticket } = await viewer.supabase
    .from('tickets')
    .select('id, vhu_status, creator_id, department_id')
    .eq('id', ticketId)
    .single();
  if (!ticket) return { error: 'Không tìm thấy yêu cầu.' };

  const isOwner = ticket.creator_id === viewer.userId;
  const effectiveRole: AppRole = isOwner && viewer.role === 'user' ? 'user' : viewer.role;

  if (!canTransition(ticket.vhu_status as VhuTicketStatus, toStatus, effectiveRole)) {
    return { error: `Không được phép chuyển trạng thái từ ${STATUS_LABELS_VI[ticket.vhu_status as VhuTicketStatus]} sang ${STATUS_LABELS_VI[toStatus]}.` };
  }
  // A regular user may only transition their own ticket.
  if (viewer.role === 'user' && !isOwner) {
    return { error: 'Bạn không có quyền thay đổi trạng thái yêu cầu này.' };
  }

  const { error } = await viewer.supabase
    .from('tickets')
    .update({ vhu_status: toStatus })
    .eq('id', ticketId);

  if (error) {
    return { error: 'Không thể chuyển trạng thái. Vui lòng thử lại.' };
  }

  if (note) {
    await createServiceRoleClient()
      .from('ticket_status_history')
      .update({ note })
      .eq('ticket_id', ticketId)
      .eq('new_status', toStatus)
      .order('created_at', { ascending: false })
      .limit(1);
  }

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'change_status',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
    oldData: { status: ticket.vhu_status },
    newData: { status: toStatus, note },
  });

  await notifyTicketParticipants(ticketId, viewer.userId, 'status_changed', 'Trạng thái yêu cầu đã thay đổi', `Yêu cầu đã chuyển sang trạng thái "${STATUS_LABELS_VI[toStatus]}".`);

  revalidatePath(`/tickets/${ticketId}`);
  revalidatePath('/tickets');
  return {};
}

async function notifyTicketParticipants(
  ticketId: number,
  actorId: string,
  eventType: string,
  title: string,
  message: string,
): Promise<void> {
  const service = createServiceRoleClient();
  const { data: ticket } = await service
    .from('tickets')
    .select('creator_id, assigned_agent_id')
    .eq('id', ticketId)
    .single();
  if (!ticket) return;

  const recipients = new Set([ticket.creator_id, ticket.assigned_agent_id].filter(Boolean) as string[]);
  recipients.delete(actorId);
  for (const recipientId of recipients) {
    await notifyUser({ recipientId, ticketId, eventType, title, message });
  }
}

// ============================================================
// 4. Assignment (§5.3 of spec — Manager only)
// ============================================================

export async function assignVhuTicket(
  ticketId: number,
  agentId: string,
  reason?: string,
): Promise<VhuActionState> {
  const viewer = await requireViewer();
  if (viewer.role !== 'manager' && viewer.role !== 'admin') {
    return { error: 'Chỉ Quản lý hoặc Quản trị viên được phân công nhân viên.' };
  }

  const { data: ticket } = await viewer.supabase
    .from('tickets')
    .select('id, vhu_status, assigned_agent_id, department_id')
    .eq('id', ticketId)
    .single();
  if (!ticket) return { error: 'Không tìm thấy yêu cầu.' };

  if (viewer.role === 'manager' && ticket.department_id && ticket.department_id !== viewer.departmentId) {
    return { error: 'Bạn chỉ được phân công yêu cầu thuộc đơn vị mình quản lý.' };
  }

  const { data: agentProfile } = await viewer.supabase
    .from('profiles')
    .select('id, role, display_name')
    .eq('id', agentId)
    .single();
  if (!agentProfile || (agentProfile.role !== 'agent' && agentProfile.role !== 'admin')) {
    return { error: 'Người được chọn không phải nhân viên hỗ trợ.' };
  }

  const previousAgent = ticket.assigned_agent_id;
  const nextStatus: VhuTicketStatus | null =
    ticket.vhu_status === 'NEW' || ticket.vhu_status === 'AI_ANALYZED' ? 'ASSIGNED' : null;

  const { error } = await viewer.supabase
    .from('tickets')
    .update({ assigned_agent_id: agentId, ...(nextStatus ? { vhu_status: nextStatus } : {}) })
    .eq('id', ticketId);
  if (error) return { error: 'Không thể phân công. Vui lòng thử lại.' };

  await createServiceRoleClient().from('ticket_assignments').insert({
    ticket_id: ticketId,
    assigned_from: previousAgent,
    assigned_to: agentId,
    assigned_by: viewer.userId,
    reason: reason ?? null,
  });

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'assign_ticket',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
    oldData: { assigned_agent_id: previousAgent },
    newData: { assigned_agent_id: agentId, reason },
  });

  await notifyUser({
    recipientId: agentId,
    ticketId,
    eventType: 'agent_assigned',
    title: 'Bạn được phân công một yêu cầu mới',
    message: `Bạn đã được phân công xử lý yêu cầu #${ticketId}.`,
  });

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

// ============================================================
// 5. Priority / category adjustment (§8 of spec)
// ============================================================

export async function adjustVhuPriority(
  ticketId: number,
  newPriority: 'low' | 'medium' | 'high' | 'critical',
  reason?: string,
): Promise<VhuActionState> {
  const viewer = await requireViewer();
  if (viewer.role !== 'manager' && viewer.role !== 'admin') {
    return { error: 'Chỉ Quản lý hoặc Quản trị viên được điều chỉnh mức ưu tiên.' };
  }

  const { data: ticket } = await viewer.supabase
    .from('tickets')
    .select('id, priority')
    .eq('id', ticketId)
    .single();
  if (!ticket) return { error: 'Không tìm thấy yêu cầu.' };

  const { error } = await viewer.supabase
    .from('tickets')
    .update({
      priority: newPriority,
      priority_adjusted_by: viewer.userId,
      priority_adjusted_at: new Date().toISOString(),
      priority_adjustment_reason: reason ?? null,
    })
    .eq('id', ticketId);
  if (error) return { error: 'Không thể điều chỉnh mức ưu tiên.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'change_priority',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
    oldData: { priority: ticket.priority },
    newData: { priority: newPriority, reason },
  });

  if (newPriority === 'critical' && ticket.priority !== 'critical') {
    await triggerUrgentWebhook(ticketId);
  }

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

export async function adjustVhuCategory(ticketId: number, categoryId: string): Promise<VhuActionState> {
  const viewer = await requireViewer();
  if (viewer.role !== 'manager' && viewer.role !== 'admin') {
    return { error: 'Chỉ Quản lý hoặc Quản trị viên được điều chỉnh danh mục.' };
  }
  const { data: ticket } = await viewer.supabase.from('tickets').select('category_id').eq('id', ticketId).single();
  const { error } = await viewer.supabase.from('tickets').update({ category_id: categoryId }).eq('id', ticketId);
  if (error) return { error: 'Không thể điều chỉnh danh mục.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'change_category',
    entityType: 'tickets',
    entityId: String(ticketId),
    ticketId,
    oldData: { category_id: ticket?.category_id },
    newData: { category_id: categoryId },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

// ============================================================
// 6. Comments (§ chi tiết ticket)
// ============================================================

export async function addVhuComment(
  ticketId: number,
  content: string,
  isInternal: boolean,
): Promise<VhuActionState> {
  const viewer = await requireViewer();
  const trimmed = content.trim();
  if (trimmed.length < 1) return { error: 'Nội dung bình luận không được để trống.' };
  if (isInternal && viewer.role === 'user') return { error: 'Bạn không có quyền thêm bình luận nội bộ.' };

  const { error } = await viewer.supabase.from('posts').insert({
    ticket_id: ticketId,
    author_id: viewer.userId,
    body: trimmed,
    post_type: isInternal ? 'note' : 'post',
    is_private: isInternal,
  });
  if (error) return { error: 'Không thể gửi bình luận.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'add_comment',
    entityType: 'posts',
    ticketId,
    newData: { is_internal: isInternal, length: trimmed.length },
  });

  if (!isInternal) {
    await notifyTicketParticipants(ticketId, viewer.userId, 'new_post', 'Có bình luận mới', 'Yêu cầu của bạn có bình luận mới.');
  }

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}

// ============================================================
// 7. Confirmation / reopen / rating (§ Requester actions)
// ============================================================

export async function confirmVhuResolution(ticketId: number): Promise<VhuActionState> {
  return changeVhuTicketStatus(ticketId, 'RESOLVED');
}

export async function reopenVhuTicket(ticketId: number, note?: string): Promise<VhuActionState> {
  return changeVhuTicketStatus(ticketId, 'REOPENED', note);
}

export async function rateVhuTicket(
  ticketId: number,
  rating: number,
  comment?: string,
): Promise<VhuActionState> {
  const viewer = await requireViewer();
  if (rating < 1 || rating > 5) return { error: 'Điểm đánh giá phải từ 1 đến 5 sao.' };

  const { data: ticket } = await viewer.supabase
    .from('tickets')
    .select('id, creator_id, vhu_status')
    .eq('id', ticketId)
    .single();
  if (!ticket) return { error: 'Không tìm thấy yêu cầu.' };
  if (ticket.creator_id !== viewer.userId) return { error: 'Bạn chỉ được đánh giá yêu cầu của chính mình.' };
  if (!['RESOLVED', 'CLOSED'].includes(ticket.vhu_status)) {
    return { error: 'Chỉ có thể đánh giá sau khi yêu cầu đã được khắc phục.' };
  }

  const { error } = await viewer.supabase
    .from('ticket_ratings')
    .upsert({ ticket_id: ticketId, requester_id: viewer.userId, rating, comment: comment?.trim() || null }, { onConflict: 'ticket_id' });
  if (error) return { error: 'Không thể lưu đánh giá.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'rate_ticket',
    entityType: 'ticket_ratings',
    ticketId,
    newData: { rating, comment },
  });

  revalidatePath(`/tickets/${ticketId}`);
  return {};
}
