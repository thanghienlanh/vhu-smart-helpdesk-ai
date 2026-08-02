// Pure helpers for SLA/overdue calculations — no Supabase calls, so these
// are directly unit-testable (see §26 of the spec: "Tính SLA", "Xác định
// ticket quá hạn").

export type SlaTicketLike = {
  response_due_at: string | null;
  resolution_due_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  vhu_status: string;
};

export type OverdueInfo = {
  isResponseOverdue: boolean;
  isResolutionOverdue: boolean;
  isOverdue: boolean;
};

const TERMINAL_STATUSES = new Set(['RESOLVED', 'CLOSED', 'CANCELLED']);

/**
 * A ticket is overdue on the response leg if it has no first response yet
 * and the response deadline has passed; overdue on the resolution leg if
 * it isn't resolved yet and the resolution deadline has passed. Terminal
 * tickets (resolved/closed/cancelled) are never counted as overdue.
 */
export function computeOverdue(ticket: SlaTicketLike, now: Date = new Date()): OverdueInfo {
  if (TERMINAL_STATUSES.has(ticket.vhu_status)) {
    return { isResponseOverdue: false, isResolutionOverdue: false, isOverdue: false };
  }

  const isResponseOverdue =
    !ticket.first_response_at &&
    !!ticket.response_due_at &&
    now.getTime() > new Date(ticket.response_due_at).getTime();

  const isResolutionOverdue =
    !ticket.resolved_at &&
    !!ticket.resolution_due_at &&
    now.getTime() > new Date(ticket.resolution_due_at).getTime();

  return {
    isResponseOverdue,
    isResolutionOverdue,
    isOverdue: isResponseOverdue || isResolutionOverdue,
  };
}

/** Formats a countdown/overdue string in Vietnamese for a given deadline. */
export function formatDueCountdown(dueAt: string | null, now: Date = new Date()): string {
  if (!dueAt) return 'Chưa xác định';
  const diffMs = new Date(dueAt).getTime() - now.getTime();
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.floor(abs / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let human: string;
  if (days > 0) human = `${days} ngày ${hours % 24} giờ`;
  else if (hours > 0) human = `${hours} giờ ${minutes % 60} phút`;
  else human = `${Math.max(minutes, 0)} phút`;

  return overdue ? `Quá hạn ${human}` : `Còn ${human}`;
}
