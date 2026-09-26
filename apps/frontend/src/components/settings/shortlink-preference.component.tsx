'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import useSWR from 'swr';
import { Select } from '@gitroom/react/form/select';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type ShortLinkPreference = 'ASK' | 'YES' | 'NO';

interface ShortlinkPreferenceResponse {
  shortlink: ShortLinkPreference;
  // false when the server has no link shortener configured
  available?: boolean;
}

export const useShortlinkPreference = () => {
  const fetch = useFetch();

  const load = useCallback(async () => {
    return (await fetch('/settings/shortlink')).json();
  }, []);

  return useSWR<ShortlinkPreferenceResponse>('shortlink-preference', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });
};

const ShortlinkPreferenceComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, isLoading, mutate } = useShortlinkPreference();

  const [localValue, setLocalValue] = useState<ShortLinkPreference>('ASK');

  // Sync local state with fetched data
  useEffect(() => {
    if (data?.shortlink) {
      setLocalValue(data.shortlink);
    }
  }, [data]);

  const handleChange = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newValue = event.target.value as ShortLinkPreference;
      const previousValue = localValue;

      // Update local state immediately (optimistic)
      setLocalValue(newValue);

      try {
        const response = await fetch('/settings/shortlink', {
          method: 'POST',
          body: JSON.stringify({ shortlink: newValue }),
        });
        if (!response.ok) {
          setLocalValue(previousValue); // roll back the select
          toaster.show(
            `${t(
              'settings_update_failed',
              'Could not update settings'
            )}: ${await readResponseError(response)}`,
            'warning'
          );
          return;
        }
        mutate({ shortlink: newValue });
        toaster.show(t('settings_updated', 'Settings updated'), 'success');
      } catch (e) {
        setLocalValue(previousValue); // roll back the select
        console.error('[Postra:settings] shortlink update failed', e);
        toaster.show(
          t('settings_update_failed', 'Could not update settings'),
          'warning'
        );
      }
    },
    [fetch, mutate, toaster, t, localValue]
  );

  if (isLoading) {
    return (
      <Card className="my-[16px] p-[24px]">
        <div className="animate-pulse">{t('loading', 'Loading...')}</div>
      </Card>
    );
  }

  // Nothing to shorten with: the choice would change nothing (E2E-05-23).
  if (data?.available === false) {
    return null;
  }

  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[24px]">
      <div className="text-[15px] font-[600]">
        {t('shortlink_settings', 'Shortlink Settings')}
      </div>
      <div className="flex items-center justify-between gap-[24px]">
        <div className="flex flex-col flex-1">
          <div className="text-[14px]">
            {t('shortlink_preference', 'Shortlink Preference')}
          </div>
          <div className="text-[12px] text-newTextColor/55">
            {t(
              'shortlink_preference_description',
              'Control how URLs in your posts are handled. Shortlinks provide click statistics.'
            )}
          </div>
        </div>
        <div className="w-[200px]">
          <Select
            name="shortlink"
            label=""
            disableForm={true}
            hideErrors={true}
            value={localValue}
            onChange={handleChange}
          >
            <option value="ASK">
              {t('shortlink_ask', 'Ask every time')}
            </option>
            <option value="YES">
              {t('shortlink_yes', 'Always shortlink')}
            </option>
            <option value="NO">
              {t('shortlink_no', 'Never shortlink')}
            </option>
          </Select>
        </div>
      </div>
    </Card>
  );
};

export default ShortlinkPreferenceComponent;

