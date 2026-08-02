'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServerClient } from '@/lib/supabase/server';
import { writeAuditLog } from '@/lib/audit/log';

export type VhuAdminState = { error?: string; success?: boolean };

async function requireAdminViewer() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase.from('profiles').select('id, email, role').eq('id', user.id).single();
  if (!profile || profile.role !== 'admin') redirect('/');
  return { supabase, userId: user.id, email: profile.email, role: profile.role };
}

// ---------------- Departments ----------------

export async function upsertDepartment(_prev: VhuAdminState, formData: FormData): Promise<VhuAdminState> {
  const viewer = await requireAdminViewer();
  const id = (formData.get('id') as string) || undefined;
  const name = (formData.get('name') as string)?.trim();
  const description = (formData.get('description') as string)?.trim() || null;
  const isActive = formData.get('is_active') === 'on';
  if (!name) return { error: 'Vui lòng nhập tên phòng ban.' };

  const { error } = id
    ? await viewer.supabase.from('departments').update({ name, description, is_active: isActive }).eq('id', id)
    : await viewer.supabase.from('departments').insert({ name, description, is_active: isActive });

  if (error) return { error: 'Không thể lưu phòng ban. Tên có thể đã tồn tại.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'update_department',
    entityType: 'departments',
    entityId: id ?? null,
    newData: { name, description, is_active: isActive },
  });

  revalidatePath('/admin/departments');
  return { success: true };
}

// ---------------- Categories (VHU fields) ----------------

export async function updateCategoryVhuFields(_prev: VhuAdminState, formData: FormData): Promise<VhuAdminState> {
  const viewer = await requireAdminViewer();
  const id = formData.get('id') as string;
  const description = (formData.get('description') as string)?.trim() || null;
  const defaultDepartmentId = (formData.get('default_department_id') as string) || null;
  const responseSla = parseInt(formData.get('response_sla_minutes') as string, 10);
  const resolutionSla = parseInt(formData.get('resolution_sla_minutes') as string, 10);
  const isActive = formData.get('is_active') === 'on';
  if (!id) return { error: 'Thiếu mã danh mục.' };

  const { data: before } = await viewer.supabase.from('categories').select('*').eq('id', id).single();

  const { error } = await viewer.supabase
    .from('categories')
    .update({
      description,
      default_department_id: defaultDepartmentId,
      response_sla_minutes: Number.isFinite(responseSla) ? responseSla : null,
      resolution_sla_minutes: Number.isFinite(resolutionSla) ? resolutionSla : null,
      is_active: isActive,
    })
    .eq('id', id);

  if (error) return { error: 'Không thể cập nhật danh mục.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'update_category',
    entityType: 'categories',
    entityId: id,
    oldData: before,
    newData: { description, default_department_id: defaultDepartmentId, response_sla_minutes: responseSla, resolution_sla_minutes: resolutionSla, is_active: isActive },
  });

  revalidatePath('/admin/vhu-categories');
  return { success: true };
}

// ---------------- SLA policies ----------------

export async function updateSlaPolicy(_prev: VhuAdminState, formData: FormData): Promise<VhuAdminState> {
  const viewer = await requireAdminViewer();
  const id = formData.get('id') as string;
  const firstResponseMinutes = parseInt(formData.get('first_response_minutes') as string, 10);
  const resolutionMinutes = parseInt(formData.get('resolution_minutes') as string, 10);
  if (!id || !Number.isFinite(firstResponseMinutes) || !Number.isFinite(resolutionMinutes)) {
    return { error: 'Giá trị không hợp lệ.' };
  }

  const { data: before } = await viewer.supabase.from('sla_policies').select('*').eq('id', id).single();

  const { error } = await viewer.supabase
    .from('sla_policies')
    .update({ first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes })
    .eq('id', id);
  if (error) return { error: 'Không thể cập nhật cấu hình SLA.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'update_sla_policy',
    entityType: 'sla_policies',
    entityId: id,
    oldData: before,
    newData: { first_response_minutes: firstResponseMinutes, resolution_minutes: resolutionMinutes },
  });

  revalidatePath('/admin/vhu-sla');
  return { success: true };
}

// ---------------- Users: role + lock/unlock ----------------

export async function updateUserRole(_prev: VhuAdminState, formData: FormData): Promise<VhuAdminState> {
  const viewer = await requireAdminViewer();
  const userId = formData.get('user_id') as string;
  const role = formData.get('role') as 'user' | 'agent' | 'manager' | 'admin';
  const departmentId = (formData.get('department_id') as string) || null;
  if (!userId || !['user', 'agent', 'manager', 'admin'].includes(role)) {
    return { error: 'Dữ liệu không hợp lệ.' };
  }

  const { data: before } = await viewer.supabase.from('profiles').select('role, department_id').eq('id', userId).single();

  const { error } = await viewer.supabase.from('profiles').update({ role, department_id: departmentId }).eq('id', userId);
  if (error) return { error: 'Không thể cập nhật vai trò.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: 'change_user_role',
    entityType: 'profiles',
    entityId: userId,
    oldData: before,
    newData: { role, department_id: departmentId },
  });

  revalidatePath('/admin/vhu-users');
  return { success: true };
}

export async function setUserLocked(userId: string, locked: boolean): Promise<VhuAdminState> {
  const viewer = await requireAdminViewer();
  const { error } = await viewer.supabase.from('profiles').update({ is_blocked: locked }).eq('id', userId);
  if (error) return { error: 'Không thể cập nhật trạng thái tài khoản.' };

  await writeAuditLog({
    actor: { id: viewer.userId, email: viewer.email, role: viewer.role },
    action: locked ? 'lock_account' : 'unlock_account',
    entityType: 'profiles',
    entityId: userId,
  });

  revalidatePath('/admin/vhu-users');
  return { success: true };
}
