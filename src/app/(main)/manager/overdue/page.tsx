import { createServerClient } from '@/lib/supabase/server';
import { requireManagerOrAdmin } from '@/lib/supabase/auth';
import { VhuTicketList, type VhuTicketListRow } from '@/components/features/vhu/VhuTicketList';
import { computeOverdue } from '@/lib/vhu/sla';

export default async function ManagerOverduePage() {
  const { profile } = await requireManagerOrAdmin();
  const supabase = await createServerClient();

  let query = supabase
    .from('tickets')
    .select(
      'id, ticket_code, title, slug, vhu_status, priority, created_at, response_due_at, resolution_due_at, first_response_at, resolved_at, requester:profiles!tickets_creator_id_fkey(display_name), agent:profiles!tickets_assigned_agent_id_fkey(display_name), category:categories(name)',
    )
    .not('vhu_status', 'in', '(RESOLVED,CLOSED,CANCELLED)')
    .order('resolution_due_at', { ascending: true });

  if (profile.role === 'manager' && profile.department_id) query = query.eq('department_id', profile.department_id);

  const { data } = await query;

  const overdueTickets: VhuTicketListRow[] = (data ?? [])
    .filter((t) => computeOverdue(t as never).isOverdue)
    .map((t) => {
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

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Yêu cầu quá hạn</h1>
      <p className="text-sm text-gray-500 mb-4">{overdueTickets.length} yêu cầu đang quá hạn phản hồi hoặc xử lý.</p>
      <VhuTicketList tickets={overdueTickets} showRequester showAgent />
    </div>
  );
}
