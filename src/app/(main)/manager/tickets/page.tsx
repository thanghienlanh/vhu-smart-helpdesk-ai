import Link from 'next/link';
import { createServerClient } from '@/lib/supabase/server';
import { requireManagerOrAdmin } from '@/lib/supabase/auth';
import { VhuTicketList, type VhuTicketListRow } from '@/components/features/vhu/VhuTicketList';
import { Pagination } from '@/components/ui/Pagination';
import { STATUS_LABELS_VI, VHU_TICKET_STATUSES } from '@/lib/vhu/types';

const PAGE_SIZE = 20;

export default async function ManagerTicketsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { profile } = await requireManagerOrAdmin();
  const supabase = await createServerClient();
  const params = await searchParams;
  const statusFilter = (params.status as string) ?? '';
  const currentPage = Math.max(1, parseInt((params.page as string) ?? '1', 10) || 1);
  const from = (currentPage - 1) * PAGE_SIZE;

  let query = supabase
    .from('tickets')
    .select(
      'id, ticket_code, title, slug, vhu_status, priority, created_at, requester:profiles!tickets_creator_id_fkey(display_name), agent:profiles!tickets_assigned_agent_id_fkey(display_name), category:categories(name)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false });

  if (profile.role === 'manager' && profile.department_id) query = query.eq('department_id', profile.department_id);
  if (statusFilter) query = query.eq('vhu_status', statusFilter);
  query = query.range(from, from + PAGE_SIZE - 1);

  const { data, count } = await query;
  const tickets: VhuTicketListRow[] = (data ?? []).map((t) => {
    const requester = Array.isArray(t.requester) ? t.requester[0] : t.requester;
    const agent = Array.isArray(t.agent) ? t.agent[0] : t.agent;
    const category = Array.isArray(t.category) ? t.category[0] : t.category;
    return {
      id: t.id, ticket_code: t.ticket_code, title: t.title, slug: t.slug,
      vhu_status: t.vhu_status, priority: t.priority, created_at: t.created_at,
      requester_name: (requester as { display_name: string | null } | null)?.display_name ?? undefined,
      agent_name: (agent as { display_name: string | null } | null)?.display_name ?? null,
      category_name: (category as { name: string } | null)?.name ?? null,
    };
  });

  const totalPages = Math.ceil((count ?? 0) / PAGE_SIZE);
  const linkParams: Record<string, string> = statusFilter ? { status: statusFilter } : {};

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-4">Yêu cầu thuộc đơn vị</h1>
      <div className="flex flex-wrap gap-2 mb-4">
        <Link href="/manager/tickets" className={`px-3 py-1.5 text-sm rounded font-medium ${!statusFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Tất cả</Link>
        {VHU_TICKET_STATUSES.map((s) => (
          <Link key={s} href={`/manager/tickets?status=${s}`} className={`px-3 py-1.5 text-sm rounded font-medium ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
            {STATUS_LABELS_VI[s]}
          </Link>
        ))}
      </div>
      <VhuTicketList tickets={tickets} showRequester showAgent />
      <Pagination currentPage={currentPage} totalPages={totalPages} basePath="/manager/tickets" searchParams={linkParams} pageSize={PAGE_SIZE} />
    </div>
  );
}
