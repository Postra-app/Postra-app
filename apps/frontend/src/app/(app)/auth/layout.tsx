export const dynamic = 'force-dynamic';
import { ReactNode } from 'react';
import type { Metadata } from 'next';

// Sign-in, sign-up, reset and activation screens are not search results:
// Google indexed /auth as a duplicate of /auth/login ("Duplicate without
// user-selected canonical", Search Console 22 X). robots.txt leaves /auth
// crawlable so this noindex is seen and the pages are dropped.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};
import loadDynamic from 'next/dynamic';
import { ProblemEffectComponent } from '@gitroom/frontend/components/auth/problem-effect.component';
import { LogoTextComponent } from '@gitroom/frontend/components/ui/logo-text.component';
const ReturnUrlComponent = loadDynamic(() => import('./return.url.component'));
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen w-screen flex-col gap-[14px] overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.14),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(167,139,250,0.14),transparent_32%),linear-gradient(180deg,#0a0e1a,#0f172a_42%,#111827)] p-[14px] text-white md:flex-row">
      <ReturnUrlComponent />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_15%,rgba(56,189,248,0.06),transparent_20%),radial-gradient(circle_at_80%_80%,rgba(167,139,250,0.08),transparent_24%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.05] [background-image:radial-gradient(rgba(255,255,255,0.75)_0.6px,transparent_0.6px)] [background-size:18px_18px]" />
      <div className="relative flex flex-1 flex-col rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.86),rgba(10,14,26,0.95))] p-[12px] text-white shadow-[0_36px_90px_rgba(2,6,23,0.42)] backdrop-blur-2xl md:w-[560px] md:flex-none lg:w-[640px]">
        <div className="mx-auto flex h-full w-full max-w-[460px] flex-col justify-center gap-[22px] px-[14px] py-[42px] text-white">
          <LogoTextComponent />
          <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(30,41,59,0.44),rgba(15,23,42,0.78))] p-[24px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
            <div className="flex">{children}</div>
          </div>
          <div className="mt-[16px] flex items-center justify-center gap-[16px] text-[12px] text-slate-400/70">
            <a
              href="https://postra.co.uk/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white/80"
            >
              Privacy Policy
            </a>
            <span className="text-slate-600">|</span>
            <a
              href="https://postra.co.uk/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-white/80"
            >
              Terms of Service
            </a>
          </div>
        </div>
      </div>
      <div className="relative hidden min-h-[720px] flex-1 flex-col items-center overflow-hidden rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(15,23,42,0.42),rgba(10,14,26,0.18))] px-[20px] pb-[20px] pt-[48px] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] md:flex lg:px-[28px] lg:pb-[28px] lg:pt-[72px]">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.12),transparent_34%),radial-gradient(circle_at_bottom,rgba(167,139,250,0.12),transparent_38%)]" />
        <div className="pointer-events-none absolute left-[12%] top-[12%] h-[180px] w-[180px] rounded-full bg-[#38bdf8]/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-[10%] right-[16%] h-[220px] w-[220px] rounded-full bg-[#a78bfa]/12 blur-[120px]" />
        <div className="relative mb-[16px] rounded-full border border-white/10 bg-white/[0.04] px-[14px] py-[6px] text-[11px] font-[700] uppercase tracking-[0.16em] text-white/58">
          For modern social media teams
        </div>
        <div className="relative max-w-[620px] text-center text-[36px] font-[500] leading-[1.05] tracking-[-0.04em] text-white/92">
          Plan faster, publish smoother and keep every channel in
          <br />
          <span className="bg-[linear-gradient(135deg,#38bdf8,#a78bfa)] bg-clip-text text-transparent">
            one polished Postra workspace
          </span>
        </div>
        <p className="relative mt-[18px] max-w-[560px] text-center text-[15px] leading-[1.7] text-slate-300/78">
          Postra brings order to planning, creating and publishing your content,
          so you move from chaos to a steady rhythm across every channel that
          matters.
        </p>
        <div className="relative mt-[26px] flex w-full max-w-[780px] flex-1 items-center justify-center px-[8px] pb-[8px] lg:mt-[34px] lg:px-[24px] lg:pb-[16px]">
          <div className="w-full max-w-[640px] rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(30,41,59,0.52),rgba(15,23,42,0.82))] p-[28px] text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] backdrop-blur-xl">
            <div className="text-[24px] font-[600] tracking-[-0.03em] text-white/92">
              See what Postra brings order to in your daily work
            </div>
            <p className="mx-auto mt-[12px] max-w-[460px] text-[14px] leading-[1.7] text-slate-300/72">
              Instead of just another tool for pushing out posts, you get a
              workflow that helps you plan, create and publish content without
              the chaos.
            </p>
            <ProblemEffectComponent />
          </div>
        </div>
      </div>
    </div>
  );
}
