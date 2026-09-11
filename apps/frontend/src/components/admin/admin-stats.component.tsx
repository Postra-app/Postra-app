'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { AdminButton as Button, adminInput, adminSegment } from './admin-ui';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import {
  formatDay,
  isoDaysAgo,
  startOfMonth,
  startOfWeek,
  today,
} from '@gitroom/frontend/components/admin/admin-dates';

interface PerSocial {
  provider: string;
  count: number;
}

interface StatsBlock {
  total: number;
  perSocial: PerSocial[];
}

interface StatsResponse {
  from: string;
  to: string;
  errors: StatsBlock;
  posts: StatsBlock;
  connected: StatsBlock;
}

// Both ends are inclusive, so "last 7 days" reaches back six — it used to
// reach back seven and cover eight days (E2E-09-22).
const PRESETS: { label: string; range: () => { from: string; to: string } }[] = [
  { label: 'Today', range: () => ({ from: today(), to: today() }) },
  { label: 'This week', range: () => ({ from: startOfWeek(), to: today() }) },
  { label: 'This month', range: () => ({ from: startOfMonth(), to: today() }) },
  { label: 'Last 7 days', range: () => ({ from: isoDaysAgo(6), to: today() }) },
  { label: 'Last 30 days', range: () => ({ from: isoDaysAgo(29), to: today() }) },
  { label: 'Last year', range: () => ({ from: isoDaysAgo(364), to: today() }) },
];

const useStats = (params: {
  from: string;
  to: string;
  unknownOnly: boolean;
}) => {
  const fetch = useFetch();
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
    ...(params.unknownOnly ? { unknownOnly: 'true' } : {}),
  });
  const key = `/admin/stats?${query.toString()}`;
  return useSWR<StatsResponse>(
    key,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error('Failed to load stats');
      }
      return res.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );
};

const SummaryCard: FC<{ label: string; value: number }> = ({
  label,
  value,
}) => (
  <div className="border border-newTableBorder rounded-[8px] p-[16px] bg-white/[0.03]">
    <div className="text-[12px] opacity-70">{label}</div>
    <div className="text-[28px] font-[600]">{value.toLocaleString()}</div>
  </div>
);

const PerSocialTable: FC<{ title: string; block: StatsBlock }> = ({
  title,
  block,
}) => (
  <div className="border border-newTableBorder rounded-[8px] overflow-hidden">
    <div className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] bg-white/[0.03] text-[12px] uppercase opacity-70 border-b border-newTableBorder">
      <div>{title}</div>
      <div className="text-right">Count</div>
    </div>
    {block.perSocial.length === 0 ? (
      <div className="px-[12px] py-[10px] text-[13px] opacity-70">
        No data for this timeframe.
      </div>
    ) : (
      block.perSocial.map((row) => (
        <div
          key={row.provider}
          className="grid grid-cols-[1fr_120px] gap-[12px] px-[12px] py-[10px] text-[13px] border-b border-newTableBorder last:border-b-0"
        >
          <div className="capitalize">{row.provider}</div>
          <div className="text-right">{row.count.toLocaleString()}</div>
        </div>
      ))
    )}
  </div>
);

export const AdminStatsComponent: FC = () => {

  const [fromInput, setFromInput] = useState(today());
  const [toInput, setToInput] = useState(today());
  const [range, setRange] = useState({ from: today(), to: today() });
  const [unknownOnly, setUnknownOnly] = useState(false);
  // Tracked by name, not by comparing ranges: on a Monday "Today" and "This
  // week" describe the same days, and both lit up (E2E-09-22).
  const [activePreset, setActivePreset] = useState<string | null>('Today');

  const { data, isLoading, error } = useStats({ ...range, unknownOnly });

  const applyRange = useCallback(
    (next: { from: string; to: string }, preset: string | null = null) => {
      setFromInput(next.from);
      setToInput(next.to);
      setRange(next);
      setActivePreset(preset);
    },
    []
  );

  return (
    <div className="flex flex-col gap-[16px] text-textColor">
      <div className="flex items-center justify-between">
        <div className="text-[20px] font-[600]">Admin Stats</div>
        {/* The range that was asked for. Rendering data.to instead showed the
            server's 23:59:59 UTC read back in local time, i.e. tomorrow. */}
        <div className="text-[13px] opacity-70">
          {formatDay(range.from)} — {formatDay(range.to)}
        </div>
      </div>

      <div className="flex flex-wrap gap-[8px]">
        {PRESETS.map((preset) => {
          const active = activePreset === preset.label;
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyRange(preset.range(), preset.label)}
              className={adminSegment(active)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-[12px] items-end bg-white/[0.03] border border-newTableBorder rounded-[8px] p-[12px]">
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">From</div>
          <input
            type="date"
            value={fromInput}
            max={toInput}
            onChange={(e) => setFromInput(e.target.value)}
            className={adminInput}
          />
        </div>
        <div className="flex flex-col gap-[6px]">
          <div className="text-[12px] opacity-70">To</div>
          <input
            type="date"
            value={toInput}
            min={fromInput}
            max={today()}
            onChange={(e) => setToInput(e.target.value)}
            className={adminInput}
          />
        </div>
        <Button
          onClick={() => {
            setRange({ from: fromInput, to: toInput });
            setActivePreset(null);
          }}
          disabled={!fromInput || !toInput || fromInput > toInput}
        >
          Apply
        </Button>

        <label
          className="flex items-center gap-[6px] text-[13px] cursor-pointer h-[38px]"
          title='Only count errors whose message matches "message":"Unknown Error" (affects the error stats only)'
        >
          <input
            type="checkbox"
            className="accent-[#38bdf8] w-[16px] h-[16px] cursor-pointer"
            checked={unknownOnly}
            onChange={(e) => setUnknownOnly(e.target.checked)}
          />
          Unknown errors only
        </label>
      </div>

      {isLoading ? (
        <LoadingComponent />
      ) : error || !data ? (
        <div className="text-red-400">Failed to load stats.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <SummaryCard label="Total posts published" value={data.posts.total} />
            <SummaryCard
              label="Total connected accounts"
              value={data.connected.total}
            />
            <SummaryCard
              label={unknownOnly ? 'Total unknown errors' : 'Total errors'}
              value={data.errors.total}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-[12px]">
            <PerSocialTable
              title="Posts published per social"
              block={data.posts}
            />
            <PerSocialTable
              title="Connected accounts per social"
              block={data.connected}
            />
            <PerSocialTable
              title={
                unknownOnly ? 'Unknown errors per social' : 'Errors per social'
              }
              block={data.errors}
            />
          </div>
        </>
      )}
    </div>
  );
};
