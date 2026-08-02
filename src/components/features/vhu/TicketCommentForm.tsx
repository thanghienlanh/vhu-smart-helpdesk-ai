'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addVhuComment } from '@/lib/actions/vhu-tickets';

export function TicketCommentForm({ ticketId, canInternal }: { ticketId: number; canInternal: boolean }) {
  const [content, setContent] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await addVhuComment(ticketId, content, isInternal);
      if (res.error) {
        setError(res.error);
      } else {
        setContent('');
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      {error && <p className="text-sm text-red-600">{error}</p>}
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={3}
        placeholder={isInternal ? 'Ghi chú nội bộ (chỉ nhân viên/quản lý xem được)...' : 'Nhập bình luận công khai...'}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
      <div className="flex items-center justify-between">
        {canInternal ? (
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
            Bình luận nội bộ (không hiển thị cho người gửi)
          </label>
        ) : <span />}
        <button
          type="submit"
          disabled={pending || content.trim().length === 0}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? 'Đang gửi...' : 'Gửi bình luận'}
        </button>
      </div>
    </form>
  );
}
