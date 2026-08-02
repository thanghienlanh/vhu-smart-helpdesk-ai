'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { assignVhuTicket, adjustVhuPriority, rerunAiAnalysis } from '@/lib/actions/vhu-tickets';
import { PRIORITY_LABELS_VI, type VhuPriority } from '@/lib/vhu/types';

type Agent = { id: string; display_name: string | null };

export function TicketManagementPanel({
  ticketId,
  agents,
  currentAgentId,
  currentPriority,
}: {
  ticketId: number;
  agents: Agent[];
  currentAgentId: string | null;
  currentPriority: VhuPriority | null;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [agentId, setAgentId] = useState(currentAgentId ?? '');
  const [priority, setPriority] = useState<VhuPriority>(currentPriority ?? 'medium');
  const [reason, setReason] = useState('');
  const router = useRouter();

  function submitAssign() {
    if (!agentId) return;
    setError(null);
    startTransition(async () => {
      const res = await assignVhuTicket(ticketId, agentId, reason || undefined);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function submitPriority() {
    setError(null);
    startTransition(async () => {
      const res = await adjustVhuPriority(ticketId, priority, reason || undefined);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  function submitRerunAi() {
    setError(null);
    startTransition(async () => {
      const res = await rerunAiAnalysis(ticketId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-md border border-gray-200 p-4 space-y-4">
      <p className="text-sm font-semibold text-gray-700">Điều phối (Quản lý / Quản trị viên)</p>
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Phân công nhân viên</label>
        <div className="flex gap-2">
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            <option value="">— Chọn nhân viên —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.display_name ?? a.id}</option>
            ))}
          </select>
          <button type="button" disabled={pending || !agentId} onClick={submitAssign} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            Phân công
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Điều chỉnh mức ưu tiên cuối cùng</label>
        <div className="flex gap-2">
          <select value={priority} onChange={(e) => setPriority(e.target.value as VhuPriority)} className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-sm">
            {(['low', 'medium', 'high', 'critical'] as VhuPriority[]).map((p) => (
              <option key={p} value={p}>{PRIORITY_LABELS_VI[p]}</option>
            ))}
          </select>
          <button type="button" disabled={pending} onClick={submitPriority} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60">
            Cập nhật
          </button>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Lý do (dùng chung cho phân công/điều chỉnh ưu tiên)</label>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Không bắt buộc" className="w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm" />
      </div>

      <button type="button" disabled={pending} onClick={submitRerunAi} className="text-sm text-blue-600 hover:text-blue-800 underline disabled:opacity-60">
        Chạy lại phân tích AI
      </button>
    </div>
  );
}
