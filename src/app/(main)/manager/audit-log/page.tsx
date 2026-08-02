import { createServerClient } from '@/lib/supabase/server';
import { requireManagerOrAdmin } from '@/lib/supabase/auth';

const PAGE_SIZE = 30;

export default async function ManagerAuditLogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireManagerOrAdmin();
  const supabase = await createServerClient();
  const params = await searchParams;
  const currentPage = Math.max(1, parseInt((params.page as string) ?? '1', 10) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;

  // RLS (audit_logs_select_manager) already restricts a Manager to rows
  // whose ticket belongs to their department; Admins see everything.
  const { data: logs, count } = await supabase
    .from('audit_logs')
    .select('id, actor_email, actor_role, action, entity_type, ticket_id, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Audit log (thuộc phạm vi đơn vị)</h1>
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Thời gian</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Người thực hiện</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Hành động</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Đối tượng</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Ticket</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(logs ?? []).map((log) => (
              <tr key={log.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 whitespace-nowrap text-gray-500">{new Date(log.created_at).toLocaleString('vi-VN')}</td>
                <td className="px-4 py-2">{log.actor_email ?? '—'} ({log.actor_role ?? '—'})</td>
                <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-2 text-gray-600">{log.entity_type}</td>
                <td className="px-4 py-2 text-gray-600">{log.ticket_id ?? '—'}</td>
              </tr>
            ))}
            {(!logs || logs.length === 0) && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Chưa có bản ghi.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && <p className="text-xs text-gray-400 mt-2">Trang {currentPage}/{totalPages}</p>}
    </div>
  );
}
