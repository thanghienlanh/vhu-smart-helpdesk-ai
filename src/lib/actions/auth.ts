'use server';

import { createServerClient, createServiceRoleClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { writeAuditLog } from '@/lib/audit/log';
import { roleHomePath } from '@/lib/supabase/auth';

export type AuthState = {
  error?: string;
  message?: string;
};

export async function login(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Email and password are required.' };
  }
  if (email.length > 320) {
    return { error: 'Email is too long.' };
  }

  const svc = createServiceRoleClient();

  // Check login_attempts lockout
  const { data: attempt } = await svc
    .from('login_attempts')
    .select('*')
    .eq('email', email.toLowerCase())
    .single();

  if (attempt && attempt.attempt_count >= 5 && attempt.locked_until) {
    const lockedUntil = new Date(attempt.locked_until);
    if (lockedUntil > new Date()) {
      const remaining = Math.ceil((lockedUntil.getTime() - Date.now()) / 60000);
      return { error: `Account locked. Try again in ${remaining} minute${remaining !== 1 ? 's' : ''}.` };
    }
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Increment login attempts
    if (attempt) {
      const newCount = attempt.attempt_count + 1;
      await svc.from('login_attempts').update({
        attempt_count: newCount,
        locked_until: newCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq('email', email.toLowerCase());
    } else {
      await svc.from('login_attempts').insert({
        email: email.toLowerCase(),
        attempt_count: 1,
        locked_until: null,
      });
    }
    await writeAuditLog({
      actor: { id: null, email, role: null },
      action: 'login_failed',
      entityType: 'auth',
    });
    return { error: 'Invalid email or password.' };
  }

  // Reset login attempts on success
  if (attempt) {
    await svc.from('login_attempts').update({
      attempt_count: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq('email', email.toLowerCase());
  }

  const { data: { user } } = await supabase.auth.getUser();
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null };

  await writeAuditLog({
    actor: { id: user?.id ?? null, email, role: profile?.role ?? null },
    action: 'login_success',
    entityType: 'auth',
  });

  redirect(roleHomePath(profile?.role));
}

export async function signup(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim();
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;
  const displayName = (formData.get('displayName') as string)?.trim() || '';

  if (!email || !password || !confirmPassword) {
    return { error: 'All fields are required.' };
  }
  if (email.length > 320) {
    return { error: 'Email is too long.' };
  }
  if (displayName.length > 100) {
    return { error: 'Display name must be 100 characters or fewer.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { error: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { error: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { error: 'Password must contain at least one digit.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        display_name: displayName || email.split('@')[0],
      },
    },
  });

  if (error) {
    return { error: error.message };
  }

  // Auto-confirmed (enable_confirmations = false) → redirect to home
  if (data.session) {
    redirect('/');
  }

  return { message: 'Check your email for a confirmation link.' };
}

export async function forgotPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim();

  if (!email) {
    return { error: 'Email is required.' };
  }
  if (email.length > 320) {
    return { error: 'Email is too long.' };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://127.0.0.1:3000';
  const supabase = await createServerClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/callback?next=/reset-password`,
  });

  // Always show success to prevent email enumeration
  return { message: 'If an account exists with that email, you will receive a password reset link.' };
}

export async function resetPassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = formData.get('password') as string;
  const confirmPassword = formData.get('confirmPassword') as string;

  if (!password || !confirmPassword) {
    return { error: 'All fields are required.' };
  }
  if (password.length < 8) {
    return { error: 'Password must be at least 8 characters.' };
  }
  if (!/[A-Z]/.test(password)) {
    return { error: 'Password must contain at least one uppercase letter.' };
  }
  if (!/[a-z]/.test(password)) {
    return { error: 'Password must contain at least one lowercase letter.' };
  }
  if (!/[0-9]/.test(password)) {
    return { error: 'Password must contain at least one digit.' };
  }
  if (password !== confirmPassword) {
    return { error: 'Passwords do not match.' };
  }

  const supabase = await createServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: error.message };
  }

  redirect('/login');
}

export async function signOut(): Promise<void> {
  const supabase = await createServerClient();
  await supabase.auth.signOut({ scope: 'local' });
  redirect('/login');
}
