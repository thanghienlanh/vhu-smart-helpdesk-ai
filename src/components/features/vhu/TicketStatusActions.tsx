'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { changeVhuTicketStatus } from '@/lib/actions/vhu-tickets';
import { STATUS_TRANSITIONS, type AppRole, type VhuTicketStatus } from '@/lib/vhu/types';

const ACTION_LABELS: Record<VhuTicketStatus, string> = {
  NEW: 'Đặt lại Mới tạo',
  AI_ANALYZED: 'Đánh dấu đã phân tích AI',
  ASSIGNED: 'Chuyển về đã phân công',
  IN_PROGRESS: 'Bắt đầu xử lý',
  WAITING_USER: 'Chờ người dùng phản hồi',
  WAITING_CONFIRMATION: 'Chuyển chờ xác nhận',
  RESOLVED: 'Xác nhận đã khắc phục',
  CLOSED: 'Đóng yêu cầu',
  REOPENED: 'Yêu cầu xử lý lại',
  CANCELLED: 'Hủy yêu cầu',
};

const ACTION_STYLES: Partial<Record<VhuTicketStatus, string>> = {
  CANCELLED: 'bg-white border border-red-300 text-red-700 hover:bg-red-50',
  REOPENED: 'bg-white border border-orange-300 text-orange-700 hover:bg-orange-50',
  CLOSED: 'bg-gray-800 text-white hover:bg-gray-900',
  RESOLVED: 'bg-emerald-600 text-white hover:bg-emerald-700',
};

export function TicketStatusActions({
  ticketId,
  currentStatus,
  viewerRole,
  isOwner,
}: {
  ticketId: number;
  currentStatus: VhuTicketStatus;
  viewerRole: AppRole;
  isOwner: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const effectiveRole: AppRole = isOwner && viewerRole === 'user' ? 'user' : viewerRole;
  const options = STATUS_TRANSITIONS[currentStatus] ?? {};
  const allowed = (Object.keys(options) as VhuTicketStatus[]).filter((to) =>
    options[to]?.includes(effectiveRole),
  );

  if (allowed.length === 0) return null;

  function handle(to: VhuTicketStatus) {
    setError(null);
    startTransition(async () => {
      const res = await changeVhuTicketStatus(ticketId, to);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div>
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {allowed.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => handle(to)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md disabled:opacity-60 ${ACTION_STYLES[to] ?? 'bg-blue-600 text-white hover:bg-blue-700'}`}
          >
            {ACTION_LABELS[to]}
          </button>
        ))}
      </div>
    </div>
  );
}
