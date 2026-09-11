'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { adminSegment } from './admin-ui';
import {
  axisLabel,
  fullLabel,
  today,
} from '@gitroom/frontend/components/admin/admin-dates';

interface ChartPoint {
  day: string;
  count: number;
}

interface GrowthResponse {
  totals: { users: number; organizations: number };
  period: { days: number; newUsers: number; newOrgs: number };
  activity: { dau: number; wau: number; mau: number };
  charts: {
    signups: ChartPoint[];
    posts: ChartPoint[];
  };
}

const PERIODS: { label: string; days: number }[] = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: '6m', days: 180 },
  { label: '12m', days: 365 },
];



const MetricCard = ({ label, value }: { label: string; value: number }) => (
  <div className="border border-white/10 rounded-[12px] p-[16px] bg-white/[0.03]">
    <div className="text-[12px] text-newTextColor opacity-70">{label}</div>
    <div className="text-[28px] font-[600] text-newTextColor">
      {value.toLocaleString()}
    </div>
  </div>
);

const BarChart = ({
  data,
  color,
  title,
}: {
  data: ChartPoint[];
  color: string;
  title: string;
}) => {
  const max = Math.max(...data.map((d) => d.count), 1);

  return (
    <div className="border border-white/10 rounded-[12px] p-[16px] bg-white/[0.03]">
      <div className="text-[14px] font-[500] text-newTextColor mb-[12px]">
        {title}
      </div>
      <div className="flex items-end gap-[2px] h-[120px]">
        {data.map((point, index) => {
          const height = (point.count / max) * 100;
          // With long ranges per-day labels collide — thin them out and
          // switch to month/day so the axis stays readable.
          const labelEvery = Math.max(1, Math.ceil(data.length / 24));
          const showLabel = index % labelEvery === 0;
          const dayLabel = axisLabel(point.day, data.length);
          return (
            <div
              key={point.day}
              className="flex flex-col items-center flex-1 h-full justify-end"
            >
              <div
                className={`w-full min-h-[2px] rounded-t-[2px] ${color}`}
                style={{ height: `${height}%` }}
                title={`${fullLabel(point.day)}: ${point.count}`}
              />
              <div className="text-[9px] text-newTextColor opacity-50 mt-[4px] whitespace-nowrap">
                {showLabel ? dayLabel : ' '}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const AdminGrowthComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [days, setDays] = useState<number>(30);
  const [fromInput, setFromInput] = useState(today());
  const [toInput, setToInput] = useState(today());
  // null = preset mode (days); set = custom from/to range
  const [customRange, setCustomRange] = useState<{
    from: string;
    to: string;
  } | null>(null);

  const rangeError = !fromInput
    ? t('admin.growthFromRequired', 'Pick a start date.')
    : !toInput
    ? t('admin.growthToRequired', 'Pick an end date.')
    : fromInput > toInput
    ? t('admin.growthRangeBackwards', 'The start date is after the end date.')
    : '';

  const query = customRange
    ? `/admin/growth?from=${customRange.from}&to=${customRange.to}`
    : `/admin/growth?days=${days}`;

  const { data, isLoading, error } = useSWR<GrowthResponse>(
    query,
    useCallback(
      async (url: string) => {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to load growth data');
        return res.json();
      },
      [fetch]
    ),
    { revalidateOnFocus: false }
  );

  return (
    <div className="flex flex-col gap-[16px] text-newTextColor">
      <div className="flex items-center justify-between flex-wrap gap-[8px]">
        <div className="text-[20px] font-[600]">{t('admin.growth', 'Growth')}</div>
        <div className="flex gap-[6px]">
          {PERIODS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => {
                setDays(p.days);
                setCustomRange(null);
              }}
              className={adminSegment(!customRange && days === p.days)}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-end flex-wrap gap-[12px] border border-white/10 rounded-[12px] p-[12px] bg-white/[0.03]">
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] opacity-70">{t('from', 'From')}</label>
          <input
            type="date"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            className="bg-input border border-tableBorder rounded-[8px] px-[10px] h-[36px] text-newTextColor text-[13px] outline-none"
          />
        </div>
        <div className="flex flex-col gap-[4px]">
          <label className="text-[12px] opacity-70">{t('to', 'To')}</label>
          <input
            type="date"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            className="bg-input border border-tableBorder rounded-[8px] px-[10px] h-[36px] text-newTextColor text-[13px] outline-none"
          />
        </div>
        <button
          type="button"
          disabled={!!rangeError}
          onClick={() => {
            // A cleared field used to send an empty from or to, the backend
            // quietly fell back to thirty days, and the button stayed lit as
            // if a custom range were in force (E2E-09-20).
            if (rangeError) {
              return;
            }
            setCustomRange({ from: fromInput, to: toInput });
          }}
          className={adminSegment(!!customRange)}
        >
          {t('apply', 'Apply')}
        </button>
        {rangeError && (
          <span className="text-[12px] text-red-400 self-center" role="alert">
            {rangeError}
          </span>
        )}
      </div>

      {error ? (
        <div className="text-[13px] text-red-400">
          {t('admin.growthLoadFailed', 'Failed to load growth data.')}
        </div>
      ) : isLoading || !data ? (
        <div className="text-[13px] opacity-50">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
            <MetricCard label={t('admin.totalUsers', 'Total Users')} value={data.totals.users} />
            <MetricCard label={t('admin.totalOrgs', 'Total Orgs')} value={data.totals.organizations} />
            <MetricCard label={t('admin.newUsers', 'New Users')} value={data.period.newUsers} />
            <MetricCard label={t('admin.newOrgs', 'New Orgs')} value={data.period.newOrgs} />
          </div>

          <div className="grid grid-cols-3 gap-[12px]">
            <MetricCard label={t('admin.dau', 'DAU')} value={data.activity.dau} />
            <MetricCard label={t('admin.wau', 'WAU')} value={data.activity.wau} />
            <MetricCard label={t('admin.mau', 'MAU')} value={data.activity.mau} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
            <BarChart
              data={data.charts.signups}
              color="bg-sky-400"
              title={t('admin.signups', 'Signups')}
            />
            <BarChart
              data={data.charts.posts}
              color="bg-violet-400"
              title={t('admin.publishedPosts', 'Published Posts')}
            />
          </div>
        </>
      )}
    </div>
  );
};
