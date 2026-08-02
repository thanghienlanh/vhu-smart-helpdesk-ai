'use client';

import { useActionState } from 'react';
import { createVhuTicket, type VhuActionState } from '@/lib/actions/vhu-tickets';

type Category = { id: string; name: string; description: string | null };

const initialState: VhuActionState = {};

export function VhuTicketForm({ categories }: { categories: Category[] }) {
  const [state, formAction, pending] = useActionState(createVhuTicket, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {state.error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Tiêu đề <span className="text-red-500">*</span>
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          minLength={5}
          maxLength={300}
          placeholder="Ví dụ: Máy tính phòng A203 không kết nối được Internet"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {state.fieldErrors?.title && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.title}</p>}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
          Nội dung chi tiết <span className="text-red-500">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          required
          minLength={20}
          rows={6}
          placeholder="Mô tả chi tiết sự cố, thời điểm xảy ra, các bước bạn đã thử..."
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {state.fieldErrors?.description && <p className="mt-1 text-xs text-red-600">{state.fieldErrors.description}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Địa điểm</label>
          <input id="location" name="location" type="text" placeholder="VD: Phòng A203" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="device_name" className="block text-sm font-medium text-gray-700 mb-1">Tên thiết bị (nếu có)</label>
          <input id="device_name" name="device_name" type="text" placeholder="VD: Máy số 12" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="category_id" className="block text-sm font-medium text-gray-700 mb-1">Danh mục</label>
          <select id="category_id" name="category_id" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="">Để AI gợi ý</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="urgency" className="block text-sm font-medium text-gray-700 mb-1">Mức độ ảnh hưởng</label>
          <select id="urgency" name="urgency" defaultValue="medium" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="low">Thấp — không ảnh hưởng công việc hiện tại</option>
            <option value="medium">Trung bình — ảnh hưởng một người, có cách xử lý tạm</option>
            <option value="high">Cao — ảnh hưởng lớp học/phòng ban</option>
            <option value="critical">Khẩn cấp — ảnh hưởng kỳ thi/an toàn thông tin</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="contact_phone" className="block text-sm font-medium text-gray-700 mb-1">Số điện thoại liên hệ</label>
          <input id="contact_phone" name="contact_phone" type="tel" placeholder="09xxxxxxxx" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label htmlFor="desired_resolution_at" className="block text-sm font-medium text-gray-700 mb-1">Thời gian mong muốn xử lý</label>
          <input id="desired_resolution_at" name="desired_resolution_at" type="datetime-local" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        Sau khi gửi, hệ thống AI sẽ tự động phân tích, tóm tắt và đề xuất mức ưu tiên cho yêu cầu của bạn.
        Kết quả AI chỉ mang tính gợi ý — Quản lý/Quản trị viên sẽ xem xét và quyết định cuối cùng.
      </p>

      <div className="flex justify-end gap-3">
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {pending ? 'Đang gửi...' : 'Gửi yêu cầu'}
        </button>
      </div>
    </form>
  );
}
