'use client';

import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import {
  cookieName,
  fallbackLng,
  languages,
} from '@gitroom/react/translation/i18n.config';
import i18next from 'i18next';
import useCookie from 'react-use-cookie';
import ReactCountryFlag from 'react-country-flag';
import {
  FLAGS_URL,
  getCountryCodeForFlag,
} from '@gitroom/frontend/components/layout/flag.code';
import { List, Box, Group, Text } from '@mantine/core';
import React, { useCallback } from 'react';

import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { ModalWrapperComponent } from '../new-launch/modal.wrapper.component';

import clsx from 'clsx';

export const ChangeLanguageComponent = () => {
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const availableLanguages = languages;
  const [_, setCookie] = useCookie(cookieName, currentLanguage || fallbackLng);
  const modals = useModals();
  const t = useT();

  const handleLanguageChange = (language: string) => {
    setCookie(language);
    i18next.changeLanguage(language);
    modals.closeCurrent();
    const rtlLanguages = ['he', 'ar'];
    const dir = rtlLanguages.includes(language) ? 'rtl' : 'ltr';
    document.documentElement.setAttribute('dir', dir);
  };

  // Function to get language name in its native script
  const getLanguageName = useCallback((code: string) => {
    try {
      // Use browser's Intl API to get language name in native script
      const displayNames = new Intl.DisplayNames([code], {
        type: 'language',
      });
      return displayNames.of(code);
    } catch (error) {
      // Fallback to language code if the API isn't supported or language is not found
      return code;
    }
  }, []);

  return (
    <div className="relative">
      <div className="grid grid-cols-4 gap-2">
        {availableLanguages.map((language) => (
          <button
            type="button"
            className={clsx(
              'flex items-center flex-col bg-newTableHeader hover:bg-newTableBorder p-[20px] cursor-pointer gap-2',
              language === currentLanguage ? 'border border-textColor' : ''
            )}
            key={language}
            aria-pressed={language === currentLanguage}
            onClick={() => handleLanguageChange(language)}
          >
            <ReactCountryFlag
              countryCode={getCountryCodeForFlag(language)}
              cdnUrl={FLAGS_URL}
              svg
              style={{
                width: '1.5em',
                height: '1.5em',
              }}
              title={language}
            />
            <Text weight={language === currentLanguage ? 'bold' : 'normal'}>
              {getLanguageName(language)}
            </Text>
          </button>
        ))}
      </div>
    </div>
  );
};
export const LanguageComponent = () => {
  const modal = useModals();
  const currentLanguage = i18next.resolvedLanguage || fallbackLng;
  const t = useT();
  const openModal = () => {
    modal.openModal({
      title: t('change_language', 'Change Language'),
      withCloseButton: true,
      children: <ChangeLanguageComponent />,
    });
  };
  return (
    <button
      type="button"
      onClick={openModal}
      aria-label={t('change_language', 'Change Language')}
      className="rounded-full overflow-hidden h-[22px] w-[22px] relative cursor-pointer"
    >
      <ReactCountryFlag
        countryCode={getCountryCodeForFlag(currentLanguage)}
        cdnUrl={FLAGS_URL}
        svg
        style={{
          width: '22px',
          height: '22px',
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
          objectFit: 'cover',
        }}
        title={currentLanguage}
      />
    </button>
  );
};
