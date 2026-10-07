'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import useSWR from 'swr';
import { Slider } from '@gitroom/react/form/slider';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface EmailNotifications {
  sendSuccessEmails: boolean;
  sendFailureEmails: boolean;
}

export const useEmailNotifications = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/user/email-notifications')).json();
  }, []);

  return useSWR<EmailNotifications>('email-notifications', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const EmailNotificationsComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, isLoading } = useEmailNotifications();

  const [localSettings, setLocalSettings] = useState<EmailNotifications>({
    sendSuccessEmails: false,
    sendFailureEmails: true,
  });

  // Keep a ref to always have the latest state
  const settingsRef = useRef(localSettings);
  settingsRef.current = localSettings;
  const saving = useRef<Promise<void>>(Promise.resolve());

  // Sync local state with fetched data
  useEffect(() => {
    if (data) {
      setLocalSettings(data);
    }
  }, [data]);

  const updateSetting = useCallback(
    async (key: keyof EmailNotifications, value: boolean) => {
      // Use ref to get the latest state
      const previousSettings = settingsRef.current;
      const newData = {
        ...previousSettings,
        [key]: value,
      };

      // Update local state immediately (optimistic)
      settingsRef.current = newData;
      setLocalSettings(newData);

      // Saves go out one after another, in the order clicked: two quick
      // toggles could land in reverse, and the earlier one won (FE-S-7).
      const turn = saving.current;
      let release!: () => void;
      saving.current = new Promise<void>((r) => (release = r));
      await turn;

      try {
        const response = await fetch('/user/email-notifications', {
          method: 'POST',
          body: JSON.stringify(newData),
        });
        if (!response.ok) {
          setLocalSettings(previousSettings); // roll back the toggle
          toaster.show(
            `${t(
              'settings_update_failed',
              'Could not update settings'
            )}: ${await readResponseError(response)}`,
            'warning'
          );
          return;
        }
        toaster.show(t('settings_updated', 'Settings Updated'), 'success');
      } catch (e) {
        setLocalSettings(previousSettings); // roll back the toggle
        console.error(
          '[Postra:settings] email-notifications update failed',
          e
        );
        toaster.show(
          t('settings_update_failed', 'Could not update settings'),
          'warning'
        );
      } finally {
        release();
      }
    },
    []
  );

  const handleSuccessEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendSuccessEmails', value === 'on');
    },
    [updateSetting]
  );

  const handleFailureEmailsChange = useCallback(
    (value: 'on' | 'off') => {
      updateSetting('sendFailureEmails', value === 'on');
    },
    [updateSetting]
  );

  if (isLoading) {
    return (
      <Card className="my-[16px] p-[24px]">
        <div className="animate-pulse">
          {t('loading', 'Loading')}
        </div>
      </Card>
    );
  }

  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[24px]">
      <div className="text-[15px] font-[600]">
        {t('email_notifications', 'Email notifications')}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('success_emails', 'Success emails')}
          </div>
          <div className="text-[12px] text-newTextColor/55">
            {t(
              'success_emails_description',
              'Receive email notifications when posts are published successfully'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendSuccessEmails ? 'on' : 'off'}
          label={t('success_emails', 'Success emails')}
          onChange={handleSuccessEmailsChange}
          fill={true}
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <div className="text-[14px]">
            {t('failure_emails', 'Failure emails')}
          </div>
          <div className="text-[12px] text-newTextColor/55">
            {t(
              'failure_emails_description',
              'Receive email notifications when post publishing fails'
            )}
          </div>
        </div>
        <Slider
          value={localSettings.sendFailureEmails ? 'on' : 'off'}
          label={t('failure_emails', 'Failure emails')}
          onChange={handleFailureEmailsChange}
          fill={true}
        />
      </div>
    </Card>
  );
};

export default EmailNotificationsComponent;

