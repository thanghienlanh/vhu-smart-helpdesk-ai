import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type UrgentTicketWebhookInput = {
  ticketId: number;
  ticketCode: string;
  title: string;
  categoryName: string | null;
  requesterName: string | null;
  location: string | null;
  createdAt: string;
  statusLabel: string;
};

const MAX_ATTEMPTS = 3;

function buildMessage(input: UrgentTicketWebhookInput): string {
  const createdLocal = new Date(input.createdAt).toLocaleString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  return [
    '🚨 YÊU CẦU CNTT KHẨN CẤP',
    `Mã yêu cầu: ${input.ticketCode}`,
    `Tiêu đề: ${input.title}`,
    `Danh mục: ${input.categoryName ?? 'Chưa phân loại'}`,
    'Mức ưu tiên: Khẩn cấp',
    `Người gửi: ${input.requesterName ?? 'Không rõ'}`,
    `Địa điểm: ${input.location ?? 'Không rõ'}`,
    `Thời gian tạo: ${createdLocal}`,
    `Trạng thái: ${input.statusLabel}`,
  ].join('\n');
}

async function postToTelegram(token: string, chatId: string, text: string, timeoutMs: number): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const body = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, body: body.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a Telegram alert for a ticket whose FINAL priority is URGENT.
 * - Idempotent: `idempotencyKey` (ticket id + event type) is UNIQUE in
 *   webhook_logs, so a second call for the same event is a no-op.
 * - Retries up to 3 times on failure/timeout before giving up.
 * - Falls back to a simulated send (logged, not actually delivered) when
 *   TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are unset or WEBHOOK_SIMULATION_MODE=true.
 * - NEVER throws: a Telegram outage must not fail ticket creation.
 */
export async function sendUrgentTicketWebhook(
  input: UrgentTicketWebhookInput,
  eventType: 'ticket_urgent' | 'ticket_reescalated' = 'ticket_urgent',
): Promise<void> {
  const idempotencyKey = `${eventType}:${input.ticketId}`;
  const client = createServiceRoleClient();

  // Idempotency check — a row already exists for this ticket+event.
  const { data: existing } = await client
    .from('webhook_logs')
    .select('id, status')
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (existing) return;

  const payload = {
    ticket_code: input.ticketCode,
    title: input.title,
    category: input.categoryName,
    priority: 'URGENT',
    location: input.location,
    status: input.statusLabel,
  };

  const simulationMode = process.env.WEBHOOK_SIMULATION_MODE === 'true';
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // Reserve the idempotency key up front (unique constraint prevents a race
  // between two concurrent callers from double-sending).
  const { data: logRow, error: insertError } = await client
    .from('webhook_logs')
    .insert({
      ticket_id: input.ticketId,
      event_type: eventType,
      idempotency_key: idempotencyKey,
      payload,
      attempt_count: 0,
      status: 'PENDING',
    })
    .select('id')
    .single();

  if (insertError || !logRow) {
    // Someone else won the race, or a transient DB error — either way, do
    // not block ticket creation.
    return;
  }

  if (simulationMode || !token || !chatId) {
    await client
      .from('webhook_logs')
      .update({
        status: 'SIMULATED',
        attempt_count: 1,
        http_status: null,
        error_message: !token || !chatId ? 'Thiếu TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID — đã ghi log ở chế độ mô phỏng.' : null,
        sent_at: new Date().toISOString(),
      })
      .eq('id', logRow.id);
    return;
  }

  const message = buildMessage(input);
  let lastError = '';
  let lastStatus: number | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await postToTelegram(token, chatId, message, 10_000);
      lastStatus = result.status;
      if (result.ok) {
        await client
          .from('webhook_logs')
          .update({
            status: 'SENT',
            attempt_count: attempt,
            http_status: result.status,
            sent_at: new Date().toISOString(),
          })
          .eq('id', logRow.id);
        return;
      }
      lastError = `HTTP ${result.status}: ${result.body}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'Lỗi không xác định khi gửi webhook.';
    }
  }

  await client
    .from('webhook_logs')
    .update({
      status: 'FAILED',
      attempt_count: MAX_ATTEMPTS,
      http_status: lastStatus,
      error_message: lastError.slice(0, 500),
    })
    .eq('id', logRow.id);
}
