import { createServerClient } from '@/lib/supabase/server';
import { requireAuth } from '@/lib/supabase/auth';
import { VhuTicketForm } from '@/components/features/vhu/VhuTicketForm';

export default async function NewTicketPage() {
  await requireAuth();
  const supabase = await createServerClient();

  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, description')
    .eq('is_active', true)
    .order('name');

  return (
    <div>
      <h1 className="text-2xl font-semibold text-gray-900 mb-1">Tạo yêu cầu hỗ trợ CNTT</h1>
      <p className="text-sm text-gray-500 mb-6">
        Điền thông tin bên dưới, hệ thống VHU Smart Helpdesk AI sẽ tự động phân tích và định tuyến yêu cầu của bạn.
      </p>
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <VhuTicketForm categories={categories ?? []} />
      </div>
    </div>
  );
}
