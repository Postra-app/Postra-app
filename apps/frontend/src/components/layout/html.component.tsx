'use client';
import { FC, ReactNode, useEffect, useState } from 'react';
import { useTranslationSettings } from '@gitroom/react/translation/get.transation.service.client';
import { registerDayjsLocales } from '@gitroom/frontend/components/layout/dayjs.locales';

// Dates follow the interface language on every page, not only the calendar.
registerDayjsLocales();

export const HtmlComponent: FC = () => {
  const settings = useTranslationSettings();
  const [dir, setDir] = useState(settings.dir());

  useEffect(() => {
    settings.on('languageChanged', (lng) => {
      setDir(settings.dir());
    });
  }, []);

  useEffect(() => {
    const htmlElement = document.querySelector('html');
    if (htmlElement) {
      htmlElement.setAttribute('dir', dir);
    }
  }, [dir]);

  useEffect(() => {
    const match = document.cookie.match(/(?:^|;\s*)mode=(dark|light)/);
    const mode = match?.[1] || 'dark';
    document.body.classList.remove('dark', 'light');
    document.body.classList.add(mode);
  }, []);

  return null;
};
