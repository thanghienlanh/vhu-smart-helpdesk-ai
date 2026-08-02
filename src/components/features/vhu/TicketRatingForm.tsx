'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { rateVhuTicket } from '@/lib/actions/vhu-tickets';

export function TicketRatingForm({
  ticketId,
  existingRating,
}: {
  ticketId: number;
  existingRating: { rating: number; comment: string | null } | null;
}) {
  const [rating, setRating] = useState(existingRating?.rating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(existingRating?.comment ?? '');
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  function submit() {
    if (rating < 1) {
      setError('Vui lòng chọn số sao đánh giá.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await rateVhuTicket(ticketId, rating, comment);
      if (res.error) setError(res.error);
      else {
        setDone(true);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-md border border-gray-200 p-4 bg-gray-50">
      <p className="text-sm font-medium text-gray-700 mb-2">
        {existingRating ? 'Đánh giá của bạn' : 'Đánh giá mức độ hài lòng'}
      </p>
      <div className="flex gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            aria-label={`${star} sao`}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(star)}
            className="text-2xl leading-none"
          >
            <span className={(hover || rating) >= star ? 'text-amber-400' : 'text-gray-300'}>★</span>
          </button>
        ))}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Nhận xét thêm (không bắt buộc)"
        rows={2}
        className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm mb-2"
      />
      {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
      {done && !error && <p className="text-sm text-emerald-600 mb-2">Cảm ơn bạn đã đánh giá!</p>}
      <button
        type="button"
        onClick={submit}
        disabled={pending}
        className="px-3 py-1.5 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {pending ? 'Đang gửi...' : existingRating ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
      </button>
    </div>
  );
}
