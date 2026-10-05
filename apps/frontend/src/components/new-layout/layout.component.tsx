'use client';

import React, { ReactNode, useCallback } from 'react';
import { useFollowOrgChange } from '@gitroom/frontend/components/layout/org.broadcast';
import { Logo } from '@gitroom/frontend/components/new-layout/logo';
import { GeistSans } from 'geist/font/sans';
const ModeComponent = dynamic(
  () => import('@gitroom/frontend/components/layout/mode.component'),
  {
    ssr: false,
  }
);

import clsx from 'clsx';
import dynamic from 'next/dynamic';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { usePathname, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { CheckPayment } from '@gitroom/frontend/components/layout/check.payment';
import { ToolTip } from '@gitroom/frontend/components/layout/top.tip';
// media.component drags the whole Uppy suite — keep it out of the app-shell
// bundle; the modal mounts lazily.
const ShowMediaBoxModal = dynamic(
  () =>
    import('@gitroom/frontend/components/media/media.component').then(
      (mod) => mod.ShowMediaBoxModal
    ),
  { ssr: false }
);
import { ShowLinkedinCompany } from '@gitroom/frontend/components/launches/helpers/linkedin.component';
import { MediaSettingsLayout } from '@gitroom/frontend/components/launches/helpers/media.settings.component';
import { Toaster } from '@gitroom/react/toaster/toaster';
import { ShowPostSelector } from '@gitroom/frontend/components/post-url-selector/post.url.selector';
import { NewSubscription } from '@gitroom/frontend/components/layout/new.subscription';
import { Support } from '@gitroom/frontend/components/layout/support';
import { ContinueProvider } from '@gitroom/frontend/components/layout/continue.provider';
import { ContextWrapper } from '@gitroom/frontend/components/layout/user.context';
import { CopilotKit } from '@copilotkit/react-core';
import { MantineWrapper } from '@gitroom/react/helpers/mantine.wrapper';
import { AnnouncementBanner } from '@gitroom/frontend/components/layout/announcement.banner';
import { Title } from '@gitroom/frontend/components/layout/title';
import { TopMenu } from '@gitroom/frontend/components/layout/top.menu';
import { LanguageComponent } from '@gitroom/frontend/components/layout/language.component';
import { ChromeExtensionComponent } from '@gitroom/frontend/components/layout/chrome.extension.component';
import NotificationComponent from '@gitroom/frontend/components/notifications/notification.component';
import { OrganizationSelector } from '@gitroom/frontend/components/layout/organization.selector';
import { StreakComponent } from '@gitroom/frontend/components/layout/streak.component';
import { PreConditionComponent } from '@gitroom/frontend/components/layout/pre-condition.component';
import { AttachToFeedbackIcon } from '@gitroom/frontend/components/new-layout/sentry.feedback.component';
import { FirstBillingComponent } from '@gitroom/frontend/components/billing/first.billing.component';
import { MobileNav, BottomNav } from '@gitroom/frontend/components/new-layout/mobile-nav';
import { AgentHistoryMobile } from '@gitroom/frontend/components/agents/agent.history.mobile';
import { TrialTracker } from '@gitroom/frontend/components/layout/gtm.component';
import { ImpersonationBanner } from '@gitroom/frontend/components/new-layout/impersonation-banner';

export const LayoutComponent = ({ children }: { children: ReactNode }) => {
  const fetch = useFetch();

  const { backendUrl, billingEnabled, isGeneral } = useVariables();

  // Feedback icon component attaches Sentry feedback to a top-bar icon when DSN is present
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const load = useCallback(async (path: string) => {
    return await (await fetch(path)).json();
  }, []);
  const { data: user, mutate } = useSWR('/user/self', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshWhenOffline: false,
    refreshWhenHidden: false,
  });

  useFollowOrgChange(user?.orgId);

  if (!user) return null;

  return (
    <ContextWrapper user={user}>
      <CopilotKit
        credentials="include"
        runtimeUrl={backendUrl + '/copilot/chat'}
        showDevConsole={false}
      >
        <MantineWrapper>
          <ToolTip />
          <Toaster />
          <TrialTracker />
          <CheckPayment check={searchParams.get('check') || ''} mutate={mutate}>
            <ShowMediaBoxModal />
            <ShowLinkedinCompany />
            <MediaSettingsLayout />
            <ShowPostSelector />
            <PreConditionComponent />
            <NewSubscription />
            <ContinueProvider />
            <div
              className={clsx(
                'flex flex-col min-h-screen min-w-screen text-newTextColor p-[14px] relative',
                GeistSans.className
              )}
            >
              {user?.impersonate && <ImpersonationBanner email={user?.email} />}
              <div />
              {user.tier === 'FREE' && isGeneral && billingEnabled ? (
                <FirstBillingComponent />
              ) : (
                <>
                  <AnnouncementBanner />
                  <div className="flex-1 flex gap-[8px]">
                    <Support />
                    <div className="hidden md:flex flex-col w-[84px] rounded-[18px] border border-white/10 bg-white/[0.03] shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
                      <div
                        id="left-menu"
                        className={clsx(
                          'fixed h-full w-[64px] start-[10px] flex flex-1 top-0',
                          false
                        )}
                      >
                        <div className="flex flex-col h-full gap-[12px] flex-1 py-[16px] items-center overflow-y-auto scrollbar scrollbar-thumb-fifth scrollbar-track-newBgColor">
                          <Logo />
                          <TopMenu />
                        </div>
                      </div>
                    </div>
                    <div className="app-shell-surface flex-1 rounded-[20px] overflow-hidden flex flex-col gap-[1px] blurMe border border-white/10 shadow-[0_32px_120px_rgba(2,6,23,0.42)] bg-[rgba(15,23,42,0.72)] backdrop-blur-xl">
                      <div className="app-shell-topbar relative z-[10] flex bg-[rgba(15,23,42,0.82)] backdrop-blur-xl h-[56px] md:h-[60px] px-[16px] md:px-[24px] items-center gap-[8px] border-b border-white/10">
                        <MobileNav />
                        <div className="text-[20px] md:text-[24px] font-[600] flex flex-1 phone:justify-center truncate">
                          <Title />
                        </div>
                        <div className="flex gap-[12px] md:gap-[20px] text-textItemBlur items-center">
                          <div className="hidden md:flex items-center gap-[20px]">
                            <StreakComponent />
                            <div className="w-[1px] h-[20px] bg-blockSeparator" />
                            <OrganizationSelector />
                            <div className="hover:text-newTextColor">
                              <ModeComponent />
                            </div>
                            <div className="w-[1px] h-[20px] bg-blockSeparator" />
                            <LanguageComponent />
                            <ChromeExtensionComponent />
                            <div className="w-[1px] h-[20px] bg-blockSeparator" />
                            <AttachToFeedbackIcon />
                          </div>
                          {pathname?.startsWith('/agents') && (
                            <AgentHistoryMobile />
                          )}
                          <NotificationComponent />
                        </div>
                      </div>
                      {/* The page itself: a screen reader's "skip to main content"
                          had no landmark to land on (Lighthouse landmark-one-main). */}
                      <main className="app-shell-content flex phone:flex-col flex-1 gap-[1px] pb-[64px] md:pb-0 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(8,14,28,0.96))]">
                        {children}
                      </main>
                    </div>
                  </div>
                  <BottomNav />
                </>
              )}
            </div>
          </CheckPayment>
        </MantineWrapper>
      </CopilotKit>
    </ContextWrapper>
  );
};
