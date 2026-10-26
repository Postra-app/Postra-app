'use client';

import i18next from './i18next';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UseTranslationOptions } from 'react-i18next/index';
import { LanguageContext } from './language.context';

export function useT(ns?: string, options?: UseTranslationOptions<any>) {
  // The server has no browser to detect from, so the shared i18next instance
  // renders the fallback there; the language the layout resolved (cookie, else
  // Accept-Language) is passed per render instead, without touching the
  // instance other requests share. The browser starts on the same language
  // (VariableContextComponent), so hydration sees the same text (React #418
  // on every Polish browser, Sentry POSTRA-E).
  // In the browser i18next keeps the old language until the new one's
  // resources arrive, so while it is switching, translate in the target
  // language (suspending until it loads) rather than show other text.
  const language = useContext(LanguageContext);
  const lng =
    typeof window === 'undefined'
      ? language
      : (i18next as { isLanguageChangingTo?: string }).isLanguageChangingTo;
  const { t } = useTranslation(ns, lng ? { ...options, lng } : options);
  return t;
}

export function useTranslationSettings() {
  const [savedI18next, setSavedI18next] = useState(i18next);

  return savedI18next;
}
