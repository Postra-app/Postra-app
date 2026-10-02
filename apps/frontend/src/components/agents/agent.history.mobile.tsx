'use client';

import { FC, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import useSWR from 'swr';
import { useParams } from 'next/navigation';
import clsx from 'clsx';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

/**
 * The agent's conversation history on mobile. On desktop it lives in the side
 * panel (Threads), which is hidden on phones — this component puts an icon in
 * the top bar (next to the bell) that opens a bottom sheet with the list of
 * conversations and "New conversation". Rendered only on `/agents` (and only
 * below 768px, via `hidden phone:flex` on the trigger).
 */
export const AgentHistoryMobile: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const [open, setOpen] = useState(false);
  const { id } = useParams<{ id: string }>();

  const loader = useCallback(async () => {
    return (await fetch('/copilot/list')).json();
  }, []);
  // Fetch the list only once the sheet is open.
  const { data } = useSWR(open ? 'threads-mobile' : null, loader);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <div
        onClick={() => setOpen(true)}
        className="hidden phone:flex cursor-pointer w-[34px] h-[34px] items-center justify-center rounded-[10px] hover:text-newTextColor transition-colors"
        aria-label={t('chat_history', 'Chat history')}
        data-tooltip-id="tooltip"
        data-tooltip-content={t('chat_history', 'Chat history')}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M12 8v4l2.5 1.5M3.05 11a9 9 0 1 1 .2 3M3 11V7m0 4h4"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[600] flex flex-col justify-end">
          <style>{`.js-bottom-nav { display: none !important; }`}</style>
          <div
            className="absolute inset-0 bg-[rgba(2,6,23,0.7)] backdrop-blur-sm animate-fadeIn"
            onClick={close}
          />
          <div className="relative w-full max-h-[72vh] flex flex-col rounded-t-[20px] border-t border-white/10 bg-[rgba(15,23,42,0.96)] backdrop-blur-xl shadow-[0_-20px_60px_rgba(2,6,23,0.6)] pb-[env(safe-area-inset-bottom)]">
            <div className="flex items-center px-[20px] pt-[16px] pb-[12px] border-b border-white/10">
              <div className="flex-1 text-[18px] font-[600]">
                {t('chat_history', 'Chat history')}
              </div>
              <div
                onClick={close}
                className="cursor-pointer text-textColor/60 hover:text-white w-[28px] h-[28px] flex items-center justify-center text-[18px]"
              >
                ✕
              </div>
            </div>
            <div className="p-[16px] flex flex-col gap-[8px] overflow-y-auto">
              <Link
                href="/agents"
                onClick={close}
                className="flex items-center justify-center gap-[6px] min-h-[44px] rounded-[12px] bg-[linear-gradient(135deg,#38bdf8,#a78bfa)] text-slate-950 font-[700] text-[15px]"
              >
                + {t('start_a_new_chat', 'New chat')}
              </Link>
              {data?.threads?.length ? (
                data.threads.map((p: any) => (
                  <Link
                    key={p.id}
                    href={`/agents/${p.id}`}
                    onClick={close}
                    className={clsx(
                      'overflow-hidden text-ellipsis whitespace-nowrap px-[14px] py-[12px] rounded-[12px] border transition-colors',
                      p.id === id
                        ? 'bg-white/[0.06] border-sky-300/15 text-textColor'
                        : 'border-transparent text-textColor/75 hover:text-textColor hover:bg-white/[0.04]'
                    )}
                  >
                    {p.title}
                  </Link>
                ))
              ) : (
                <div className="text-center text-textColor/50 text-[14px] py-[20px]">
                  {t('no_previous_chats', 'No previous chats')}
                </div>
              )}
            </div>
          </div>
        </div>,
          document.body
        )}
    </>
  );
};
