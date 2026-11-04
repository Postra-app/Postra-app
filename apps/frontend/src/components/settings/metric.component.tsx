'use client';

import { Select } from '@gitroom/react/form/select';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import React, { useCallback, useState } from 'react';
import { isUSCitizen } from '@gitroom/frontend/components/launches/helpers/isuscitizen.utils';
import timezones from 'timezones-list';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import {
  browserTimezone,
  isTimezone,
} from '@gitroom/frontend/components/layout/set.timezone';
const dateMetrics = [
  { label: 'AM:PM', value: 'US' },
  { label: '24 hours', value: 'GLOBAL' },
];

// The list has names that are not IANA timezones (Europe/Zaporizhzhia).
const timezoneOptions = timezones.filter((zone) => isTimezone(zone.tzCode));

const MetricComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const [currentMetric, setCurrentMetric] = useState(isUSCitizen());
  // Empty = the browser's timezone.
  const [timezone, setTimezone] = useState(user?.timezoneName || '');
  const changeMetric = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    setCurrentMetric(value === 'US');
    localStorage.setItem('isUS', value);
  };

  const changeTimezone = useCallback(
    async (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      setTimezone(value);
      const response = await fetch('/user/timezone', {
        method: 'POST',
        body: JSON.stringify({ timezoneName: value || null }),
      });

      if (!response.ok) {
        setTimezone(user?.timezoneName || '');
        toaster.show(
          t('could_not_save_timezone', 'Could not save the timezone'),
          'warning'
        );
        return;
      }

      // Everything on screen was drawn in the previous timezone.
      window.location.reload();
    },
    [user?.timezoneName, fetch, t, toaster]
  );
  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[24px]">
      <div className="text-[15px] font-[600]">
        {t('date_metrics', 'Time format')}
      </div>
      <Select name="metric" disableForm={true} label="" aria-label={t('date_metrics', 'Time format')} onChange={changeMetric} value={currentMetric ? 'US' : 'GLOBAL'}>
        {dateMetrics.map((metric) => (
          <option
            key={metric.value}
            value={metric.value}
          >
            {metric.label}
          </option>
        ))}
      </Select>

      <div className="text-[15px] font-[600]">
        {t('timezone', 'Timezone')}
      </div>
      <Select
        name="timezone"
        disableForm={true}
        label=""
        aria-label={t('timezone', 'Timezone')}
        onChange={changeTimezone}
        value={timezone}
      >
        <option value="">
          {t('automatic_timezone', 'Automatic ({{timezone}})', {
            timezone: browserTimezone(),
            interpolation: { escapeValue: false },
          })}
        </option>
        {timezoneOptions.map((zone) => (
          <option key={zone.tzCode} value={zone.tzCode}>
            {zone.label}
          </option>
        ))}
      </Select>
    </Card>
  );
};

export default MetricComponent;
