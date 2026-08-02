import Link from 'next/link';
import { VhuStatusBadge, VhuPriorityBadge } from './VhuBadges';

export type VhuTicketListRow = {
  id: number;
  ticket_code: string;
  title: string;
  slug: string;
  vhu_status: string;
  priority: string | null;
  created_at: string;
  requester_name?: string;
  agent_name?: string | null;
  category_name?: string | null;
};

export function VhuTicketList({
  tickets,
  showRequester = false,
  showAgent = false,
}: {
  tickets: VhuTicketListRow[];
  showRequester?: boolean;
  showAgent?: boolean;
}) {
  if (tickets.length === 0) {
    return (
      <div className="text-center py-12 text-gray-500 bg-white rounded-lg border border-gray-200">
        <p className="text-sm">Không có yêu cầu nào.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-2 text-left font-medium text-gray-500">Mã</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">Tiêu đề</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">Danh mục</th>
            {showRequester && <th className="px-4 py-2 text-left font-medium text-gray-500">Người gửi</th>}
            {showAgent && <th className="px-4 py-2 text-left font-medium text-gray-500">Nhân viên</th>}
            <th className="px-4 py-2 text-left font-medium text-gray-500">Ưu tiên</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">Trạng thái</th>
            <th className="px-4 py-2 text-left font-medium text-gray-500">Ngày tạo</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tickets.map((t) => (
            <tr key={t.id} className="hover:bg-gray-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link href={`/tickets/${t.id}/${t.slug}`} className="text-blue-600 hover:text-blue-800 font-medium">
                  {t.ticket_code}
                </Link>
              </td>
              <td className="px-4 py-2 max-w-xs truncate">
                <Link href={`/tickets/${t.id}/${t.slug}`} className="hover:text-blue-700">{t.title}</Link>
              </td>
              <td className="px-4 py-2 text-gray-600">{t.category_name ?? '—'}</td>
              {showRequester && <td className="px-4 py-2 text-gray-600">{t.requester_name ?? '—'}</td>}
              {showAgent && <td className="px-4 py-2 text-gray-600">{t.agent_name ?? 'Chưa phân công'}</td>}
              <td className="px-4 py-2"><VhuPriorityBadge priority={t.priority} /></td>
              <td className="px-4 py-2"><VhuStatusBadge status={t.vhu_status} /></td>
              <td className="px-4 py-2 whitespace-nowrap text-gray-500">
                {new Date(t.created_at).toLocaleDateString('vi-VN')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
