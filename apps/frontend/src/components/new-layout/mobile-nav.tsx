'use client';

import { FC, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import clsx from 'clsx';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { useMenuItem } from '@gitroom/frontend/components/layout/top.menu';
import { MenuItem } from '@gitroom/frontend/components/new-layout/menu-item';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  MenuEntry,
  canSeeMenuEntry,
} from '@gitroom/frontend/components/layout/menu.visibility';

const BottomNavItem: FC<{
  path: string;
  label: string;
  icon: React.ReactNode;
}> = ({ path, label, icon }) => {
  const currentPath = usePathname();
  const isActive = currentPath.indexOf(path) === 0;
  return (
    <Link
      href={path}
      prefetch={true}
      className={clsx(
        'flex flex-col items-center justify-center gap-[2px] flex-1 h-full text-[10px] font-[600] transition-colors',
        isActive ? 'text-[#38bdf8]' : 'text-textItemBlur',
      )}
    >
      <div className="w-[22px] h-[22px] flex items-center justify-center">
        {icon}
      </div>
      <span className="leading-tight">{label}</span>
    </Link>
  );
};

export const BottomNav: FC = () => {
  const user = useUser();
  const { firstMenu, secondMenu } = useMenuItem();
  const { isGeneral, billingEnabled } = useVariables();
  const t = useT();

  if (
    !user?.orgId ||
    // @ts-expect-error user.tier is typed as PricingInnerInterface, compared to a string literal
    (user?.tier === 'FREE' && isGeneral && billingEnabled)
  ) {
    return null;
  }

  const calendar = firstMenu.find((m) => m.path === '/launches');
  const agents = firstMenu.find((m) => m.path === '/agents');
  const media = firstMenu.find((m) => m.path === '/media');
  const settings = secondMenu.find((m) => m.path === '/settings');

  const items = [calendar, agents, media, settings].filter(Boolean) as Array<{
    path: string;
    name: React.ReactNode;
    icon: React.ReactNode;
  }>;

  return (
    <nav
      aria-label={t('mobile_nav', 'Mobile navigation')}
      className="js-bottom-nav md:hidden fixed bottom-0 start-0 end-0 h-[64px] bg-[rgba(15,23,42,0.92)] backdrop-blur-xl border-t border-white/10 flex items-stretch z-40 pb-[env(safe-area-inset-bottom)]"
    >
      {items.map((item) => (
        <BottomNavItem
          key={item.path}
          path={item.path}
          label={typeof item.name === 'string' ? item.name : String(item.name)}
          icon={item.icon}
        />
      ))}
    </nav>
  );
};

export const MobileNav: FC = () => {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const t = useT();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={t('open_menu', 'Open menu')}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="md:hidden flex items-center justify-center w-[40px] h-[40px] rounded-[10px] text-textItemBlur hover:text-newTextColor hover:bg-white/[0.06] transition-colors"
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="3" y1="6" x2="21" y2="6" />
          <line x1="3" y1="12" x2="21" y2="12" />
          <line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      {/* Portal na body: topbar ma backdrop-blur, który robi containing block
          dla fixed — drawer renderowany w nim byłby przycięty do nagłówka. */}
      {open &&
        createPortal(
          <div className="md:hidden fixed inset-0 z-[600]">
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fadeIn"
              onClick={() => setOpen(false)}
            />
            <aside
              aria-label={t('main_menu', 'Main menu')}
              className="absolute start-0 top-0 h-full w-[260px] bg-[rgba(10,14,26,0.98)] border-e border-white/10 shadow-[0_24px_80px_rgba(2,6,23,0.6)] flex flex-col animate-fadeIn"
            >
              <div className="flex items-center justify-between px-[16px] h-[56px] border-b border-white/10">
                <Logo />
                <button
                  type="button"
                  aria-label={t('close_menu', 'Close menu')}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center w-[36px] h-[36px] rounded-[10px] text-textItemBlur hover:text-newTextColor hover:bg-white/[0.06] transition-colors"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-col flex-1 overflow-y-auto py-[16px] px-[8px] gap-[6px]">
                <MobileDrawerMenu />
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  );
};

const MobileDrawerMenu: FC = () => {
  const user = useUser();
  const { firstMenu, secondMenu } = useMenuItem();
  const { isGeneral, billingEnabled } = useVariables();

  const filter = (f: MenuEntry) => canSeeMenuEntry(f, user, billingEnabled);

  return (
    <>
      <div className="flex flex-col gap-[4px]">
        {
          user?.orgId &&
            // @ts-expect-error user.tier is typed as PricingInnerInterface, compared to a string literal
            (user.tier !== 'FREE' || !isGeneral || !billingEnabled) &&
            firstMenu
              .filter(filter)
              .map((item, index) => (
                <MenuItem
                  key={`drawer-first-${index}`}
                  path={item.path}
                  label={item.name}
                  icon={item.icon}
                  onClick={item.onClick}
                />
              ))
        }
      </div>
      <div className="h-[1px] bg-white/[0.08] my-[8px]" />
      <div className="flex flex-col gap-[4px]">
        {secondMenu.filter(filter).map((item, index) => (
          <MenuItem
            key={`drawer-second-${index}`}
            path={item.path}
            label={item.name}
            icon={item.icon}
            onClick={item.onClick}
          />
        ))}
      </div>
    </>
  );
};
