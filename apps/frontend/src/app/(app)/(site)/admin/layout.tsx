'use client';

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const tabs = [
  { key: 'stats', path: '/admin/stats', icon: '📊', i18n: 'admin_stats', fallback: 'Stats' },
  { key: 'growth', path: '/admin/growth', icon: '📈', i18n: 'admin_growth_tab', fallback: 'Growth' },
  { key: 'organizations', path: '/admin/organizations', icon: '🏢', i18n: 'admin_organizations', fallback: 'Organizations' },
  { key: 'subscriptions', path: '/admin/subscriptions', icon: '💳', i18n: 'admin_subscriptions', fallback: 'Subscriptions' },
  { key: 'ai-usage', path: '/admin/ai-usage', icon: '✨', i18n: 'admin_ai_usage', fallback: 'AI Usage' },
  { key: 'health', path: '/admin/health', icon: '❤️', i18n: 'admin_health', fallback: 'System Health' },
  { key: 'errors', path: '/admin/errors', icon: '🐞', i18n: 'admin_errors', fallback: 'Errors' },
  { key: 'users', path: '/admin/users', icon: '👤', i18n: 'admin_users', fallback: 'Users' },
  { key: 'announcements', path: '/admin/announcements', icon: '📣', i18n: 'admin_announcements', fallback: 'Announcements' },
  { key: 'audit', path: '/admin/audit', icon: '🧾', i18n: 'admin_audit', fallback: 'Audit', isNew: true },
  { key: 'channels', path: '/admin/channels', icon: '🔗', i18n: 'admin_channels', fallback: 'Channels', isNew: true },
  { key: 'dashboards', path: '/admin/dashboards', icon: '🖥️', i18n: 'admin_dashboards', fallback: 'Dashboards', isNew: true },
] as const;

const ADMIN_BG =
  'radial-gradient(1200px 700px at 78% -12%, rgba(56,189,248,.10), transparent),' +
  'radial-gradient(950px 620px at -5% 112%, rgba(167,139,250,.11), transparent),' +
  '#0a0e1a';

export default function AdminLayout({ children }: { children: ReactNode }) {
  const user = useUser();
  const pathname = usePathname();
  const t = useT();

  // Impersonation forces isSuperAdmin=true on the session so the admin can
  // un-impersonate, but the panel itself must reflect the real user's view —
  // block it while impersonating (the global "Stop" banner stays available).
  if (!user?.isSuperAdmin || user?.impersonate) {
    return (
      <div className="flex-1 flex items-center justify-center text-newTextColor/60">
        {t('no_access', 'You do not have access to this page.')}
      </div>
    );
  }

  return (
    <>
      {/* The panel is a desktop tool and says so, rather than rendering a
          layout it cannot fit. Below ~900px the fixed 230px sidebar leaves
          less room than the narrowest table needs, and the app shell clips
          the overflow instead of scrolling it — at 390px that hid 458px of
          every row, the View and Copy buttons included (E2E-09-48,
          E2E-09-52). */}
      <div
        className="hidden adminNarrow:flex flex-1 flex-col items-center justify-center gap-[8px] text-center px-[24px] py-[48px]"
        style={{ background: ADMIN_BG }}
      >
        <div className="text-[15px] font-[600] text-newTextColor">
          {t('admin_needs_wider_screen', 'The admin panel needs a wider screen')}
        </div>
        <div className="text-[13px] text-newTextColor/60 max-w-[320px]">
          {t(
            'admin_needs_wider_screen_note',
            'Its tables do not fit on a phone. Open it on a laptop or a desktop.'
          )}
        </div>
      </div>

      <div
        className="adminNarrow:hidden flex-1 flex min-w-0"
        style={{ background: ADMIN_BG }}
      >
      {/* Sidebar */}
      <aside className="w-[230px] shrink-0 border-r border-white/10 bg-white/[0.02] py-[18px] px-[12px]">
        <div className="flex items-center gap-[9px] px-[10px] pb-[16px] font-[700] text-[15px] text-newTextColor">
          <span className="w-[9px] h-[9px] rounded-full bg-[#38bdf8] shadow-[0_0_10px_#38bdf8]" />
          Postra · Admin
        </div>
        {/* A screen reader was getting ten anonymous links with no indication
            of which one it was standing on (E2E-09-56). */}
        <nav className="flex flex-col gap-[2px]" aria-label="Admin sections">
          {tabs.map((tab) => {
            const isActive = pathname.startsWith(tab.path);
            return (
              <Link
                key={tab.key}
                href={tab.path}
                aria-current={isActive ? 'page' : undefined}
                className={clsx(
                  'flex items-center gap-[10px] px-[11px] py-[9px] rounded-[10px] text-[13px] font-[500] transition-all duration-150',
                  isActive
                    ? 'text-white border border-white/15 bg-gradient-to-r from-[rgba(56,189,248,0.25)] to-[rgba(167,139,250,0.18)] shadow-[0_0_14px_-8px_rgba(56,189,248,0.35)]'
                    : 'text-newTextColor/55 hover:text-newTextColor/90 hover:bg-white/[0.05] border border-transparent'
                )}
              >
                <span className="w-[16px] text-center opacity-90">{tab.icon}</span>
                {t(tab.i18n, tab.fallback)}
                {'isNew' in tab && tab.isNew && (
                  <span className="ml-auto text-[9px] bg-[#38bdf8] text-[#06222e] px-[6px] py-[1px] rounded-[6px] font-[700]">
                    NEW
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div className="flex-1 flex flex-col min-w-0">{children}</div>
      </div>
    </>
  );
}
