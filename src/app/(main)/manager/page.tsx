import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireManagerOrAdmin } from '@/lib/supabase/auth';
import { StatCard } from '@/components/features/vhu/StatCard';
import { VhuBarChart, VhuPieChart } from '@/components/features/vhu/VhuStatusChart';
import { computeOverdue } from '@/lib/vhu/sla';
import { STATUS_LABELS_VI, PRIORITY_LABELS_VI, type VhuTicketStatus, type VhuPriority } from '@/lib/vhu/types';

export default async function ManagerDashboardPage() {
  const { profile } = await requireManagerOrAdmin();
  const supabase = await createServerClient();

  let query = supabase
    .from('tickets')
    .select('id, vhu_status, priority, response_due_at, resolution_due_at, first_response_at, resolved_at, created_at');
  if (profile.role === 'manager' && profile.department_id) query = query.eq('department_id', profile.department_id);

  const { data: tickets } = await query;
  const rows = tickets ?? [];

  const total = rows.length;
  const byStatus: Record<string, number> = {};
  const byPriority: Record<string, number> = {};
  let overdueCount = 0;
  let urgentCount = 0;

  for (const t of rows) {
    byStatus[t.vhu_status] = (byStatus[t.vhu_status] ?? 0) + 1;
    if (t.priority) byPriority[t.priority] = (byPriority[t.priority] ?? 0) + 1;
    if (t.priority === 'critical') urgentCount++;
    if (computeOverdue(t as never).isOverdue) overdueCount++;
  }

  const { data: ratings } = profile.role === 'manager' && profile.department_id
    ? await supabase.from('ticket_ratings').select('rating, ticket_id, tickets!inner(department_id)').eq('tickets.department_id', profile.department_id)
    : await supabase.from('ticket_ratings').select('rating');
  const avgRating = ratings && ratings.length > 0
    ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
    : '—';

  const resolvedOrClosed = (byStatus.RESOLVED ?? 0) + (byStatus.CLOSED ?? 0);
  const resolutionRate = total > 0 ? `${Math.round((resolvedOrClosed / total) * 100)}%` : '—';

  const statusChartData = (Object.keys(STATUS_LABELS_VI) as VhuTicketStatus[])
    .map((s) => ({ label: STATUS_LABELS_VI[s], count: byStatus[s] ?? 0 }))
    .filter((d) => d.count > 0);

  const priorityChartData = (['low', 'medium', 'high', 'critical'] as VhuPriority[])
    .map((p) => ({ label: PRIORITY_LABELS_VI[p], count: byPriority[p] ?? 0 }))
    .filter((d) => d.count > 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-gray-900">Bảng điều khiển Quản lý</h1>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard label="Tổng số yêu cầu" value={total} />
        <StatCard label="Đang xử lý" value={byStatus.IN_PROGRESS ?? 0} />
        <StatCard label="Chờ xác nhận" value={byStatus.WAITING_CONFIRMATION ?? 0} />
        <StatCard label="Đã khắc phục" value={byStatus.RESOLVED ?? 0} />
        <StatCard label="Đã đóng" value={byStatus.CLOSED ?? 0} />
        <StatCard label="Đã mở lại" value={byStatus.REOPENED ?? 0} />
        <StatCard label="Quá hạn" value={overdueCount} />
        <StatCard label="Khẩn cấp" value={urgentCount} />
        <StatCard label="Tỉ lệ giải quyết" value={resolutionRate} />
        <StatCard label="Điểm hài lòng TB" value={avgRating} hint="trên 5 sao" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Ticket theo trạng thái</p>
          <VhuBarChart data={statusChartData} />
        </div>
        <div className="rounded-lg border border-gray-200 p-4">
          <p className="text-sm font-semibold text-gray-700 mb-2">Ticket theo mức ưu tiên</p>
          <VhuPieChart data={priorityChartData} />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link href="/manager/tickets" className="text-blue-600 hover:underline">Tất cả yêu cầu thuộc đơn vị →</Link>
        <Link href="/manager/overdue" className="text-blue-600 hover:underline">Yêu cầu quá hạn →</Link>
        <Link href="/manager/performance" className="text-blue-600 hover:underline">Hiệu suất nhân viên →</Link>
        <Link href="/manager/audit-log" className="text-blue-600 hover:underline">Audit log →</Link>
      </div>
    </div>
  );
}
