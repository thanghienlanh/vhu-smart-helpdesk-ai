import 'server-only';
import { createServiceRoleClient } from '@/lib/supabase/server';

export type VhuNotificationInput = {
  recipientId: string;
  ticketId: number;
  eventType: string;
  title: string;
  message: string;
};

/** Creates an in-app notification row. Realtime delivery is handled by the
 * Supabase Realtime publication already enabled on `notifications` (see
 * migration 009_in_app_notifications.sql) — no extra wiring needed here. */
export async function notifyUser(input: VhuNotificationInput): Promise<void> {
  const client = createServiceRoleClient();
  const { error } = await client.from('notifications').insert({
    recipient_id: input.recipientId,
    ticket_id: input.ticketId,
    event_type: input.eventType,
    title: input.title,
    message: input.message,
  });
  if (error) {
    console.error('[vhu-notify] failed to create notification:', error.message);
  }
}
