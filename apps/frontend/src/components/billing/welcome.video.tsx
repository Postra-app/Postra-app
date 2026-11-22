'use client';

import React, { FC, useCallback } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// The two-minute tour of Postra, served by the app itself: no third-party
// player, so nothing is loaded and no cookie is set next to the checkout.
export const WELCOME_VIDEO = '/welcome/postra-welcome.mp4';
export const WELCOME_POSTER = '/welcome/postra-welcome.jpg';

// A small picture with a play button on the plan page. The film opens in a
// window and starts only after the click, so the page weighs the poster alone.
export const WelcomeVideo: FC = () => {
  const modals = useModals();
  const t = useT();
  const title = t('billing_welcome_video_title', 'Postra in 2 minutes');

  const open = useCallback(() => {
    modals.openModal({
      title,
      // Never taller than the screen: the window starts 100px down and adds
      // its title and padding, so the width follows the height that is left.
      size: 'min(1000px, 92vw, calc((100vh - 290px) * 16 / 9))',
      children: (
        <video
          data-testid="welcome-video"
          className="w-full aspect-video rounded-[12px] bg-black"
          src={WELCOME_VIDEO}
          poster={WELCOME_POSTER}
          controls
          autoPlay
          playsInline
          preload="metadata"
        />
      ),
    });
  }, [modals, title]);

  return (
    <button
      type="button"
      onClick={open}
      className="group mt-[28px] flex items-center gap-[16px] text-start rounded-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#618DFF]"
    >
      <span className="relative block w-[176px] mobile:w-[132px] aspect-video shrink-0 overflow-hidden rounded-[12px] border border-newColColor">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={WELCOME_POSTER}
          alt=""
          loading="lazy"
          className="w-full h-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/10 transition-colors">
          <span className="flex h-[44px] w-[44px] items-center justify-center rounded-full bg-white/95 shadow-lg">
            <svg width="16" height="18" viewBox="0 0 16 18" aria-hidden="true">
              <path d="M2 1.5v15l13-7.5z" fill="#0a0e1a" />
            </svg>
          </span>
        </span>
      </span>
      <span className="flex flex-col gap-[4px]">
        <span className="text-[18px] font-[600] group-hover:underline">
          {t('billing_welcome_video_watch', 'Watch the tour')}
        </span>
        <span className="text-[14px] text-newTextColor/60">{title}</span>
      </span>
    </button>
  );
};
