'use client';

import React from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Card } from '@gitroom/frontend/components/ui/card';
import dynamic from 'next/dynamic';
import EmailNotificationsComponent from '@gitroom/frontend/components/settings/email-notifications.component';
import ShortlinkPreferenceComponent from '@gitroom/frontend/components/settings/shortlink-preference.component';
import DeleteAccountComponent from '@gitroom/frontend/components/settings/delete-account.component';
import LanguagePreferenceComponent from '@gitroom/frontend/components/settings/language-preference.component';
import ProfileComponent from '@gitroom/frontend/components/settings/profile.component';

const MetricComponent = dynamic(
  () => import('@gitroom/frontend/components/settings/metric.component'),
  {
    ssr: false,
  }
);

export const GlobalSettings = () => {
  const t = useT();
  return (
    <div className="flex flex-col">
      <h3 className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
        {t('global_settings', 'Global Settings')}
      </h3>
      <p className="text-[12.5px] text-newTextColor/55 mt-[3px]">
        {t('global_settings_sub', 'Account, notification and link preferences')}
      </p>
      <ProfileComponent />
      <LanguagePreferenceComponent />
      <MetricComponent />
      <EmailNotificationsComponent />
      <ShortlinkPreferenceComponent />
      {/* AGPL §13: users interacting with Postra over the network must get a
          visible offer of the source of the version we run (CI deploys public
          main verbatim). The billing-FAQ mention alone is not prominent enough. */}
      <Card className="my-[16px] p-[24px] flex flex-col gap-[8px]">
        <div className="text-[15px] font-[600] text-newTextColor">
          {t('open_source', 'Open source')}
        </div>
        <div className="text-[13px] text-newTextColor/70 max-w-[560px]">
          {t(
            'open_source_description',
            'Postra is open-source software (AGPL-3.0). The complete source code of the version you are using is available at'
          )}
          &nbsp;
          <a
            href="https://github.com/Postra-app/Postra-app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-[#38bdf8]"
          >
            github.com/Postra-app/Postra-app
          </a>
          .
        </div>
      </Card>
      <DeleteAccountComponent />
    </div>
  );
};
