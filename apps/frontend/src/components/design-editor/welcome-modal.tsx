'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useEditorStore } from './editor.store';

const WELCOME_KEY = 'postra:studio-welcomed';

const isFirstTime = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    return !window.localStorage.getItem(WELCOME_KEY);
  } catch {
    return false;
  }
};

const markWelcomed = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WELCOME_KEY, String(Date.now()));
  } catch {
    // localStorage unavailable — non-fatal, just shows welcome again next time
  }
};

export const WelcomeModal: FC = () => {
  const t = useT();
  const user = useUser();
  const aiAllowed = !!user?.tier?.image_generator;
  const { setTool } = useEditorStore();
  const [open, setOpen] = useState(false);
  const firstButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isFirstTime()) setOpen(true);
  }, []);

  const close = () => {
    markWelcomed();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    firstButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previousActive?.focus?.();
    };
  }, [open]);

  const startWithTool = (tool: 'templates' | 'ai' | 'stock') => {
    setTool(tool);
    close();
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-modal-title"
    >
      <div
        className="relative w-full max-w-md mx-4 bg-[rgba(15,23,42,0.92)] backdrop-blur-xl rounded-lg shadow-2xl border border-newBorder p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-5">
          <div className="text-4xl mb-2">🎨</div>
          <h2
            id="welcome-modal-title"
            className="text-xl font-semibold text-textColor mb-1"
          >
            {t('welcome_title', 'Welcome to Studio')}
          </h2>
          <p className="text-sm text-textColor/60">
            {t(
              'welcome_subtitle',
              'Create social media graphics in seconds. Where would you like to start?'
            )}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            ref={firstButtonRef}
            onClick={() => startWithTool('templates')}
            className="text-left p-4 rounded-md bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors group"
          >
            <div className="text-base font-semibold flex items-center gap-2">
              <span>📐</span>
              <span>{t('welcome_cta_templates', 'Start from a template')}</span>
            </div>
            <div className="text-xs text-textColor/60 group-hover:text-white/70 mt-1">
              {t(
                'welcome_desc_templates',
                'Pick a ready-made design and customise it'
              )}
            </div>
          </button>

          {/* The free, no-credit route was missing from the one screen whose
              whole job is answering "where do I start". */}
          <button
            onClick={() => startWithTool('stock')}
            className="text-left p-4 rounded-md bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors group"
          >
            <div className="text-base font-semibold flex items-center gap-2">
              <span>🏞</span>
              <span>{t('welcome_cta_stock', 'Free stock photo')}</span>
            </div>
            <div className="text-xs text-textColor/60 group-hover:text-white/70 mt-1">
              {t(
                'welcome_desc_stock',
                'Thousands of photos you can post commercially — no credit needed'
              )}
            </div>
          </button>

          <button
            onClick={() => startWithTool('ai')}
            className="text-left p-4 rounded-md bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors group"
          >
            <div className="text-base font-semibold flex items-center gap-2">
              <span>✨</span>
              <span>{t('welcome_cta_ai', 'Generate with AI')}</span>
            </div>
            <div className="text-xs text-textColor/60 group-hover:text-white/70 mt-1">
              {aiAllowed
                ? t(
                    'welcome_desc_ai',
                    'Describe your idea — AI will create a design with background and text'
                  )
                : t(
                    'welcome_desc_ai_locked',
                    'Describe your idea and AI designs it — on the Starter plan and above'
                  )}
            </div>
          </button>

          <button
            onClick={close}
            className="text-left p-4 rounded-md bg-newColColor/50 hover:bg-newColColor text-textColor transition-colors group"
          >
            <div className="text-base font-semibold flex items-center gap-2">
              <span>◻</span>
              <span>{t('welcome_cta_blank', 'Blank canvas')}</span>
            </div>
            <div className="text-xs text-textColor/60 mt-1">
              {t('welcome_desc_blank', 'Start from scratch and add your own elements')}
            </div>
          </button>
        </div>

        <p className="text-[11px] text-textColor/65 text-center mt-4 leading-snug">
          {t(
            'welcome_brand_tip',
            'Tip: set your Brand Kit once — templates, AI designs and video captions all pick up your colours and font.'
          )}
        </p>

        <button
          onClick={close}
          className="absolute top-3 right-3 text-textColor/65 hover:text-textColor text-xl leading-none"
          aria-label={t('welcome_close', 'Close')}
        >
          ×
        </button>
      </div>
    </div>
  );
};
