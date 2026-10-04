'use client';

import React, { useCallback } from 'react';
import { Select } from '@gitroom/react/form/select';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  cookieName,
  fallbackLng,
  languages,
} from '@gitroom/react/translation/i18n.config';
import i18next from 'i18next';
import useCookie from 'react-use-cookie';

const RTL = ['he', 'ar'];

const languageName = (code: string) => {
  try {
    return new Intl.DisplayNames([code], { type: 'language' }).of(code) || code;
  } catch {
    return code;
  }
};

const LanguagePreferenceComponent = () => {
  const t = useT();
  const toaster = useToaster();
  const current = i18next.resolvedLanguage || fallbackLng;
  const [, setCookie] = useCookie(cookieName, current);

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const lng = event.target.value;
      setCookie(lng);
      i18next.changeLanguage(lng);
      document.documentElement.setAttribute(
        'dir',
        RTL.includes(lng) ? 'rtl' : 'ltr'
      );
      toaster.show(t('settings_updated', 'Settings updated'), 'success');
    },
    [setCookie, toaster, t]
  );

  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[24px]">
      <div className="text-[15px] font-[600]">
        {t('language_settings', 'Language')}
      </div>
      <div className="flex items-center justify-between gap-[24px]">
        <div className="flex flex-col flex-1">
          <div className="text-[14px]">
            {t('interface_language', 'Interface language')}
          </div>
          <div className="text-[12px] text-newTextColor/55">
            {t(
              'interface_language_description',
              'New visitors get their device language automatically — change it here any time.'
            )}
          </div>
        </div>
        <div className="w-[200px]">
          <Select
            name="language"
            label=""
            aria-label={t('interface_language', 'Interface language')}
            disableForm={true}
            hideErrors={true}
            value={current}
            onChange={handleChange}
          >
            {languages.map((lng) => (
              <option key={lng} value={lng}>
                {languageName(lng)}
              </option>
            ))}
          </Select>
        </div>
      </div>
    </Card>
  );
};

export default LanguagePreferenceComponent;
