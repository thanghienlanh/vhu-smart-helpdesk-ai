import { redirect } from 'next/navigation';
import { createServerClient } from './server';

export async function getUser() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function getProfile() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  return data;
}

export async function requireAuth() {
  const user = await getUser();
  if (!user) redirect('/login');
  return user;
}

export async function requireAgent() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || !['agent', 'admin'].includes(profile.role)) redirect('/');
  return user;
}

export async function requireAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();
  if (!profile || profile.role !== 'admin') redirect('/');
  return user;
}

/** Requester (role='user') redirect target used by role-based post-login routing. */
export async function requireManagerOrAdmin() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, department_id')
    .eq('id', user.id)
    .single();
  if (!profile || !['manager', 'admin'].includes(profile.role)) redirect('/');
  return { user, profile };
}

/** Returns the caller's full VHU profile (role/department) or redirects to /login. */
export async function requireVhuProfile() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, display_name, role, department_id, is_blocked')
    .eq('id', user.id)
    .single();
  if (!profile) redirect('/login');
  if (profile.is_blocked) redirect('/login?blocked=1');
  return { user, profile };
}

/** Post-login landing route per role (§17 of spec: "Chuyển hướng theo vai trò"). */
export function roleHomePath(role: string | null | undefined): string {
  switch (role) {
    case 'admin':
      return '/admin';
    case 'manager':
      return '/manager';
    case 'agent':
      return '/agent';
    default:
      return '/tickets';
  }
}
