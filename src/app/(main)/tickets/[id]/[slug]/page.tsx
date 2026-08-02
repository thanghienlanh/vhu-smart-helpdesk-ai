import { notFound, redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { requireVhuProfile } from '@/lib/supabase/auth';
import { generateSlug } from '@/lib/utils/slug';
import { renderMarkdown } from '@/lib/utils/markdown';
import { AttachmentList } from '@/components/features/attachments/AttachmentList';
import { FileUpload } from '@/components/features/attachments/FileUpload';
import { VhuStatusBadge, VhuPriorityBadge, VhuAiStatusBadge } from '@/components/features/vhu/VhuBadges';
import { TicketStatusActions } from '@/components/features/vhu/TicketStatusActions';
import { TicketCommentForm } from '@/components/features/vhu/TicketCommentForm';
import { TicketRatingForm } from '@/components/features/vhu/TicketRatingForm';
import { TicketManagementPanel } from '@/components/features/vhu/TicketManagementPanel';
import { formatDueCountdown } from '@/lib/vhu/sla';
import { STATUS_LABELS_VI, PRIORITY_LABELS_VI, type AppRole, type VhuPriority, type VhuTicketStatus } from '@/lib/vhu/types';

function fmt(dt: string | null): string {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string; slug: string }>;
}) {
  const { id, slug } = await params;
  const ticketId = parseInt(id, 10);
  if (isNaN(ticketId)) notFound();

  const { user, profile } = await requireVhuProfile();
  const role = profile.role as AppRole;
  const supabase = await createServerClient();

  const { data: ticket } = await supabase
    .from('tickets')
    .select(`
      id, ticket_code, title, slug, location, device_name, contact_phone, desired_resolution_at,
      vhu_status, priority, urgency, severity, ai_summary, ai_category, ai_priority, ai_confidence,
      ai_reason, ai_suggested_actions, ai_status, ai_error, response_due_at, resolution_due_at,
      first_response_at, resolved_at, closed_at, priority_adjusted_by, priority_adjustment_reason,
      priority_adjusted_at, created_at, creator_id, assigned_agent_id, department_id,
      requester:profiles!tickets_creator_id_fkey(id, display_name, email),
      agent:profiles!tickets_assigned_agent_id_fkey(id, display_name),
      category:categories(id, name),
      department:departments(id, name),
      adjuster:profiles!tickets_priority_adjusted_by_fkey(display_name)
    `)
    .eq('id', ticketId)
    .maybeSingle();

  if (!ticket) notFound();

  const expectedSlug = generateSlug(ticket.title);
  if (slug !== expectedSlug && slug !== ticket.slug) {
    redirect(`/tickets/${ticket.id}/${ticket.slug}`);
  }

  const requester = Array.isArray(ticket.requester) ? ticket.requester[0] : ticket.requester;
  const agent = Array.isArray(ticket.agent) ? ticket.agent[0] : ticket.agent;
  const category = Array.isArray(ticket.category) ? ticket.category[0] : ticket.category;
  const department = Array.isArray(ticket.department) ? ticket.department[0] : ticket.department;
  const adjuster = Array.isArray(ticket.adjuster) ? ticket.adjuster[0] : ticket.adjuster;

  const isOwner = ticket.creator_id === user.id;
  const canSeeInternal = role === 'agent' || role === 'manager' || role === 'admin';
  const canManage = role === 'manager' || role === 'admin';

  const { data: posts } = await supabase
    .from('posts')
    .select('id, author_id, body, post_type, is_private, is_original, created_at, author:profiles!posts_author_id_fkey(display_name, role)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: true });

  const originalPost = (posts ?? []).find((p) => p.is_original);
  const replies = (posts ?? []).filter((p) => !p.is_original && (canSeeInternal || p.post_type !== 'note'));

  const repliesRendered = await Promise.all(
    replies.map(async (p) => ({ ...p, html: await renderMarkdown(p.body) })),
  );
  const originalHtml = originalPost ? await renderMarkdown(originalPost.body) : '';

  const { data: statusHistory } = await supabase
    .from('ticket_status_history')
    .select('id, old_status, new_status, note, created_at, changed_by:profiles!ticket_status_history_changed_by_fkey(display_name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  const { data: assignments } = await supabase
    .from('ticket_assignments')
    .select('id, created_at, reason, to_agent:profiles!ticket_assignments_assigned_to_fkey(display_name), by_user:profiles!ticket_assignments_assigned_by_fkey(display_name)')
    .eq('ticket_id', ticketId)
    .order('created_at', { ascending: false });

  const { data: rating } = await supabase
    .from('ticket_ratings')
    .select('rating, comment')
    .eq('ticket_id', ticketId)
    .maybeSingle();

  let agents: { id: string; display_name: string | null }[] = [];
  if (canManage) {
    let agentQuery = supabase.from('profiles').select('id, display_name').eq('role', 'agent').eq('is_active', true);
    if (role === 'manager' && ticket.department_id) agentQuery = agentQuery.eq('department_id', ticket.department_id);
    const { data } = await agentQuery.order('display_name');
    agents = data ?? [];
  }

  const canRate = isOwner && ['RESOLVED', 'CLOSED'].includes(ticket.vhu_status);
  const showRatingBlock = canRate || (isOwner && rating);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div>
          <p className="text-sm text-gray-500">{ticket.ticket_code}</p>
          <h1 className="text-2xl font-semibold text-gray-900">{ticket.title}</h1>
          <div className="flex flex-wrap gap-2 mt-2">
            <VhuStatusBadge status={ticket.vhu_status} />
            <VhuPriorityBadge priority={ticket.priority} />
            <VhuAiStatusBadge status={ticket.ai_status} />
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 p-4">
          <TicketStatusActions
            ticketId={ticket.id}
            currentStatus={ticket.vhu_status as VhuTicketStatus}
            viewerRole={role}
            isOwner={isOwner}
          />
        </div>

        {/* AI panel */}
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 space-y-2">
          <p className="text-sm font-semibold text-indigo-900">Phân tích của AI</p>
          <p className="text-xs text-indigo-700 italic">Kết quả AI chỉ mang tính gợi ý — Quản lý/Quản trị viên có quyền điều chỉnh quyết định cuối cùng.</p>
          {ticket.ai_status === 'FAILED' && (
            <p className="text-sm text-red-600">AI phân tích thất bại: {ticket.ai_error ?? 'Lỗi không xác định.'}</p>
          )}
          {ticket.ai_status === 'PENDING' && <p className="text-sm text-gray-500">Chưa có kết quả phân tích.</p>}
          {ticket.ai_summary && (
            <div className="text-sm text-gray-800 space-y-1">
              <p><span className="font-medium">Tóm tắt:</span> {ticket.ai_summary}</p>
              <p><span className="font-medium">Danh mục đề xuất:</span> {ticket.ai_category ?? '—'}</p>
              <p>
                <span className="font-medium">Mức ưu tiên đề xuất:</span>{' '}
                {ticket.ai_priority ? PRIORITY_LABELS_VI[ticket.ai_priority as VhuPriority] : '—'}
                {ticket.ai_confidence != null && ` (độ tin cậy ${Math.round(ticket.ai_confidence * 100)}%)`}
              </p>
              <p><span className="font-medium">Lý do:</span> {ticket.ai_reason ?? '—'}</p>
              {Array.isArray(ticket.ai_suggested_actions) && ticket.ai_suggested_actions.length > 0 && (
                <div>
                  <span className="font-medium">Các bước xử lý đề xuất:</span>
                  <ul className="list-disc list-inside ml-2">
                    {(ticket.ai_suggested_actions as string[]).map((a, i) => <li key={i}>{a}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}
          {ticket.priority_adjusted_by && (
            <p className="text-xs text-gray-500 border-t border-indigo-100 pt-2">
              Mức ưu tiên cuối cùng đã được {adjuster?.display_name ?? 'quản lý'} điều chỉnh lúc {fmt(ticket.priority_adjusted_at)}
              {ticket.priority_adjustment_reason && ` — Lý do: ${ticket.priority_adjustment_reason}`}
            </p>
          )}
        </div>

        {/* Original post */}
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-2">Nội dung gốc — {requester?.display_name} — {fmt(ticket.created_at)}</p>
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: originalHtml }} />
          {originalPost && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <AttachmentList postId={originalPost.id} canDelete={isOwner || canSeeInternal} />
              {(isOwner || canSeeInternal) && (
                <div className="mt-2">
                  <FileUpload postId={originalPost.id} allowedTypes={['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'doc', 'docx', 'txt']} maxFileSizeMb={10} maxFilesPerPost={5} existingCount={0} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Replies / comments */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">Bình luận</p>
          {repliesRendered.map((p) => {
            const author = Array.isArray(p.author) ? p.author[0] : p.author;
            return (
              <div key={p.id} className={`rounded-lg border p-3 text-sm ${p.post_type === 'note' ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-200'}`}>
                <p className="text-xs text-gray-500 mb-1">
                  {author?.display_name ?? 'Không rõ'} — {fmt(p.created_at)}
                  {p.post_type === 'note' && <span className="ml-2 text-amber-700 font-medium">Nội bộ</span>}
                </p>
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: p.html }} />
              </div>
            );
          })}
          {repliesRendered.length === 0 && <p className="text-sm text-gray-400">Chưa có bình luận nào.</p>}
          <TicketCommentForm ticketId={ticket.id} canInternal={canSeeInternal} />
        </div>

        {showRatingBlock && (
          <TicketRatingForm ticketId={ticket.id} existingRating={rating ?? null} />
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 p-4 text-sm space-y-2">
          <p><span className="text-gray-500">Người gửi:</span> {requester?.display_name}</p>
          <p><span className="text-gray-500">Danh mục:</span> {category?.name ?? '—'}</p>
          <p><span className="text-gray-500">Bộ phận:</span> {department?.name ?? '—'}</p>
          <p><span className="text-gray-500">Người phụ trách:</span> {agent?.display_name ?? 'Chưa phân công'}</p>
          <p><span className="text-gray-500">Địa điểm:</span> {ticket.location ?? '—'}</p>
          <p><span className="text-gray-500">Thiết bị:</span> {ticket.device_name ?? '—'}</p>
          <p><span className="text-gray-500">Điện thoại liên hệ:</span> {ticket.contact_phone ?? '—'}</p>
          <p><span className="text-gray-500">Mức độ ảnh hưởng:</span> {PRIORITY_LABELS_VI[ticket.urgency as VhuPriority] ?? ticket.urgency}</p>
        </div>

        <div className="rounded-lg border border-gray-200 p-4 text-sm space-y-2">
          <p className="font-semibold text-gray-700 mb-1">SLA</p>
          <p><span className="text-gray-500">Hạn phản hồi:</span> {fmt(ticket.response_due_at)}</p>
          <p className="text-xs">{formatDueCountdown(ticket.response_due_at)}</p>
          <p><span className="text-gray-500">Hạn xử lý:</span> {fmt(ticket.resolution_due_at)}</p>
          <p className="text-xs">{formatDueCountdown(ticket.resolution_due_at)}</p>
          <p><span className="text-gray-500">Phản hồi đầu tiên:</span> {fmt(ticket.first_response_at)}</p>
          <p><span className="text-gray-500">Đã khắc phục:</span> {fmt(ticket.resolved_at)}</p>
          <p><span className="text-gray-500">Đã đóng:</span> {fmt(ticket.closed_at)}</p>
        </div>

        {canManage && (
          <TicketManagementPanel
            ticketId={ticket.id}
            agents={agents}
            currentAgentId={ticket.assigned_agent_id}
            currentPriority={ticket.priority as VhuPriority | null}
          />
        )}

        <div className="rounded-lg border border-gray-200 p-4 text-sm">
          <p className="font-semibold text-gray-700 mb-2">Lịch sử trạng thái</p>
          <ul className="space-y-1.5">
            {(statusHistory ?? []).map((h) => {
              const changedBy = Array.isArray(h.changed_by) ? h.changed_by[0] : h.changed_by;
              return (
                <li key={h.id} className="text-xs text-gray-600">
                  {h.old_status ? `${STATUS_LABELS_VI[h.old_status as VhuTicketStatus]} → ` : ''}
                  <span className="font-medium">{STATUS_LABELS_VI[h.new_status as VhuTicketStatus]}</span>
                  {' — '}{changedBy?.display_name ?? 'Hệ thống'} — {fmt(h.created_at)}
                </li>
              );
            })}
            {(!statusHistory || statusHistory.length === 0) && <li className="text-xs text-gray-400">Chưa có.</li>}
          </ul>
        </div>

        {(assignments ?? []).length > 0 && (
          <div className="rounded-lg border border-gray-200 p-4 text-sm">
            <p className="font-semibold text-gray-700 mb-2">Lịch sử phân công</p>
            <ul className="space-y-1.5">
              {(assignments ?? []).map((a) => {
                const toAgent = Array.isArray(a.to_agent) ? a.to_agent[0] : a.to_agent;
                const byUser = Array.isArray(a.by_user) ? a.by_user[0] : a.by_user;
                return (
                  <li key={a.id} className="text-xs text-gray-600">
                    Giao cho <span className="font-medium">{toAgent?.display_name ?? '—'}</span> bởi {byUser?.display_name ?? '—'} — {fmt(a.created_at)}
                    {a.reason && <span className="block italic">Lý do: {a.reason}</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
