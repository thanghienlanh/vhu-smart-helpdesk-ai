import Link from 'next/link';
import { getUser, getProfile } from '@/lib/supabase/auth';
import { getUnreadCount } from '@/lib/actions/notifications';
import { NotificationBell } from '@/components/features/notifications/NotificationBell';
import { createServerClient } from '@/lib/supabase/server';
import { MobileMenu } from './MobileMenu';
import { TopNavLinks } from './TopNavLinks';
import { UserMenu } from './UserMenu';

export default async function NavBar() {
  const user = await getUser();
  const profile = user ? await getProfile() : null;
  const unreadCount = user ? await getUnreadCount() : 0;

  // Check KB visibility
  const supabase = await createServerClient();
  const { data: kbSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'kb_visible')
    .single();
  const kbVisible = kbSetting?.value === 'true';

  const displayName = profile?.display_name || user?.email || '';
  const isAgent = profile && profile.role === 'agent';
  const isManager = profile && profile.role === 'manager';
  const isAdmin = profile && profile.role === 'admin';

  // Build nav links for both desktop and mobile (top-level navigation bar)
  const navLinks: { href: string; label: string }[] = [];
  if (user && profile?.role === 'user') navLinks.push({ href: '/tickets', label: 'Yêu cầu của tôi' });
  if (isAgent) navLinks.push({ href: '/agent', label: 'Bảng điều khiển nhân viên' });
  if (isManager) navLinks.push({ href: '/manager', label: 'Bảng điều khiển quản lý' });
  if (isAdmin) navLinks.push({ href: '/admin', label: 'Quản trị hệ thống' });
  if (kbVisible) navLinks.push({ href: '/help', label: 'Trợ giúp' });

  // Build user menu links (inside the dropdown)
  const userMenuLinks: { href: string; label: string }[] = [];
  if (isAdmin) userMenuLinks.push({ href: '/admin', label: 'Quản trị hệ thống' });
  if (isManager) userMenuLinks.push({ href: '/manager', label: 'Bảng điều khiển quản lý' });
  if (isAgent || isManager || isAdmin) {
    userMenuLinks.push({ href: '/tickets', label: 'Tất cả yêu cầu' });
  }
  userMenuLinks.push({ href: '/profile', label: 'Hồ sơ cá nhân' });
  userMenuLinks.push({ href: '/notification-settings', label: 'Cài đặt thông báo' });

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3 relative" aria-label="Main navigation">
      <div className="max-w-5xl mx-auto flex items-center justify-between">
        {/* Left side */}
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold text-gray-900 focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded">
            VHU Smart Helpdesk AI
          </Link>
          {/* Mobile hamburger */}
          <MobileMenu links={navLinks} />
          {/* Desktop links */}
          <TopNavLinks links={navLinks} />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              {/* Notification bell */}
              <NotificationBell initialUnreadCount={unreadCount} userId={user.id} />

              {/* User info with dropdown */}
              <div className="hidden sm:flex items-center gap-2">
                <UserMenu
                  displayName={displayName}
                  role={profile?.role ?? null}
                  links={userMenuLinks}
                />
              </div>
            </>
          ) : (
            <a href="/login" className="text-sm text-blue-600 hover:text-blue-800 min-h-[44px] flex items-center focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none rounded px-2">
              Đăng nhập
            </a>
          )}
        </div>
      </div>
    </nav>
  );
}
