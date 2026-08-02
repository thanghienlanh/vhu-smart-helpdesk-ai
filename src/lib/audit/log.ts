import 'server-only';
import { headers } from 'next/headers';
import { createServiceRoleClient } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/vhu/types';

export type AuditAction =
  | 'login_success'
  | 'login_failed'
  | 'create_ticket'
  | 'update_ticket'
  | 'assign_ticket'
  | 'change_status'
  | 'change_priority'
  | 'change_category'
  | 'add_comment'
  | 'add_attachment'
  | 'run_ai'
  | 'rerun_ai'
  | 'send_webhook'
  | 'close_ticket'
  | 'reopen_ticket'
  | 'rate_ticket'
  | 'change_user_role'
  | 'lock_account'
  | 'unlock_account'
  | 'update_sla_policy'
  | 'update_category'
  | 'update_department';

export type AuditActor = {
  id: string | null;
  email: string | null;
  role: AppRole | string | null;
};

export type WriteAuditLogInput = {
  actor: AuditActor;
  action: AuditAction | (string & {});
  entityType: string;
  entityId?: string | null;
  ticketId?: number | null;
  oldData?: unknown;
  newData?: unknown;
  requestId?: string | null;
};

/**
 * Writes one row to `audit_logs`. Always called server-side with the
 * service-role client — Requester/Agent/Manager have no INSERT policy on
 * this table, so a client-forged log entry is not possible. IP/user-agent
 * are best-effort (a proxy/CDN not forwarding them simply yields nulls,
 * which is acceptable — this never blocks the calling mutation).
 */
export async function writeAuditLog(input: WriteAuditLogInput): Promise<void> {
  try {
    let ip: string | null = null;
    let userAgent: string | null = null;
    try {
      const hdrs = await headers();
      ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || hdrs.get('x-real-ip') || null;
      userAgent = hdrs.get('user-agent');
    } catch {
      // headers() throws outside a request context (e.g. cron/background jobs) — ignore.
    }

    const client = createServiceRoleClient();
    const { error } = await client.from('audit_logs').insert({
      actor_id: input.actor.id,
      actor_email: input.actor.email,
      actor_role: input.actor.role,
      action: input.action,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      ticket_id: input.ticketId ?? null,
      old_data: input.oldData === undefined ? null : sanitizeForLog(input.oldData),
      new_data: input.newData === undefined ? null : sanitizeForLog(input.newData),
      ip_address: ip,
      user_agent: userAgent,
      request_id: input.requestId ?? crypto.randomUUID(),
    });

    if (error) {
      // Never let audit logging break the calling mutation; log server-side only.
      console.error('[audit] failed to write audit log:', error.message);
    }
  } catch (err) {
    console.error('[audit] unexpected error writing audit log:', err);
  }
}

const SENSITIVE_KEYS = new Set([
  'password',
  'encrypted_password',
  'token',
  'access_token',
  'refresh_token',
  'api_key',
  'apikey',
  'service_role_key',
  'secret',
  'cookie',
]);

/** Strips any field whose key looks secret-ish before it is persisted. */
function sanitizeForLog(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeForLog);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = '[redacted]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeForLog(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}
