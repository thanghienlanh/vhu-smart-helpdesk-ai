import { createServerClient } from '@/lib/supabase/server';
import { requireManagerOrAdmin } from '@/lib/supabase/auth';

export default async function ManagerPerformancePage() {
  const { profile } = await requireManagerOrAdmin();
  const supabase = await createServerClient();

  let agentQuery = supabase.from('profiles').select('id, display_name').eq('role', 'agent');
  if (profile.role === 'manager' && profile.department_id) agentQuery = agentQuery.eq('department_id', profile.department_id);
  const { data: agents } = await agentQuery.order('display_name');

  let ticketQuery = supabase.from('tickets').select('assigned_agent_id, vhu_status');
  if (profile.role === 'manager' && profile.department_id) ticketQuery = ticketQuery.eq('department_id', profile.department_id);
  const { data: tickets } = await ticketQuery;

  const rows = (agents ?? []).map((agent) => {
    const assigned = (tickets ?? []).filter((t) => t.assigned_agent_id === agent.id);
    const inProgress = assigned.filter((t) => ['ASSIGNED', 'IN_PROGRESS', 'WAITING_USER', 'WAITING_CONFIRMATION'].includes(t.vhu_status)).length;
    const resolved = assigned.filter((t) => ['RESOLVED', 'CLOSED'].includes(t.vhu_status)).length;
    return { id: agent.id, name: agent.display_name ?? '—', total: assigned.length, inProgress, resolved };
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Hiệu suất nhân viên</h1>
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Nhân viên</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Tổng ticket được giao</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Đang xử lý</th>
              <th className="px-4 py-2 text-left font-medium text-gray-500">Đã hoàn thành</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-gray-50">
                <td className="px-4 py-2">{r.name}</td>
                <td className="px-4 py-2">{r.total}</td>
                <td className="px-4 py-2">{r.inProgress}</td>
                <td className="px-4 py-2">{r.resolved}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-gray-400">Chưa có nhân viên nào.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
