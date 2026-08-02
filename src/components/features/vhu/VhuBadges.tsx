import {
  STATUS_LABELS_VI,
  STATUS_BADGE_CLASSES,
  PRIORITY_LABELS_VI,
  PRIORITY_BADGE_CLASSES,
  type VhuTicketStatus,
  type VhuPriority,
} from '@/lib/vhu/types';

export function VhuStatusBadge({ status }: { status: string }) {
  const s = status as VhuTicketStatus;
  const cls = STATUS_BADGE_CLASSES[s] ?? 'bg-gray-100 text-gray-700';
  const label = STATUS_LABELS_VI[s] ?? status;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function VhuPriorityBadge({ priority }: { priority: string | null }) {
  if (!priority) return <span className="text-xs text-gray-400">—</span>;
  const p = priority as VhuPriority;
  const cls = PRIORITY_BADGE_CLASSES[p] ?? 'bg-gray-100 text-gray-700';
  const label = PRIORITY_LABELS_VI[p] ?? priority;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

export function VhuAiStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-600',
    PROCESSING: 'bg-blue-100 text-blue-700',
    COMPLETED: 'bg-emerald-100 text-emerald-700',
    FAILED: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    PENDING: 'Chờ xử lý',
    PROCESSING: 'Đang phân tích',
    COMPLETED: 'Đã phân tích',
    FAILED: 'Lỗi AI',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${map[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {labels[status] ?? status}
    </span>
  );
}
