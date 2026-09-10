'use client';

import { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { adminSegment } from './admin-ui';

interface AiUsageByType {
  type: string;
  totalCredits: number;
  count: number;
}

interface AiUsageTopOrg {
  orgId: string;
  orgName: string;
  totalCredits: number;
}

interface AiUsageHour {
  hour: string;
  count: number;
}

// One local-timezone day folded out of the UTC hour buckets the API returns.
interface DayBucket {
  key: string;
  date: Date;
  total: number;
  hours: number[];
}

interface AiTextEngine {
  engine: string;
  model: string;
  unit: string;
  inputAmount: number;
  outputAmount: number;
  calls: number;
}

interface AiTextTopOrg {
  orgId: string | null;
  orgName: string;
  inputTokens: number;
  outputTokens: number;
}

interface AiUsageResponse {
  from: string;
  to: string;
  byType: AiUsageByType[];
  topOrgs: AiUsageTopOrg[];
  byHour: AiUsageHour[];
  text?: {
    byEngine: AiTextEngine[];
    topOrgs: AiTextTopOrg[];
  };
}

const PERIODS = [7, 30, 90] as const;

// A row's amount means whatever its unit says: audio seconds for Whisper,
// pictures for the image model, tokens for everything else.
const UNIT_LABEL: Record<string, string> = {
  seconds: 's',
  images: 'img',
  tokens: 'tok',
};

const isoDaysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

export const AdminAiUsageComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [days, setDays] = useState<number>(30);

  const fetcher = useCallback(
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load AI usage');
      return res.json();
    },
    [fetch]
  );

  const { data, isLoading, error } = useSWR<AiUsageResponse>(
    `/admin/ai-usage?from=${isoDaysAgo(days)}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  // Fold UTC hour buckets into local-timezone days (with a 24-slot hour-of-day
  // histogram each), filling usage-less days so the axis stays linear in time.
  const dayBuckets = useMemo<DayBucket[]>(() => {
    if (!data) return [];
    const map = new Map<string, DayBucket>();
    const bucketFor = (d: Date) => {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getDate()).padStart(2, '0')}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key,
          date: new Date(d.getFullYear(), d.getMonth(), d.getDate()),
          total: 0,
          hours: new Array(24).fill(0),
        };
        map.set(key, bucket);
      }
      return bucket;
    };
    const first = new Date(data.from);
    const end = new Date(data.to);
    for (
      const cursor = new Date(
        first.getFullYear(),
        first.getMonth(),
        first.getDate()
      );
      cursor <= end;
      cursor.setDate(cursor.getDate() + 1)
    ) {
      bucketFor(cursor);
    }
    for (const point of data.byHour) {
      const d = new Date(point.hour);
      const bucket = bucketFor(d);
      bucket.total += point.count;
      bucket.hours[d.getHours()] += point.count;
    }
    return [...map.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [data]);

  // Default to the busiest day — that is the spike the admin came to inspect.
  const selectedDay =
    dayBuckets.find((d) => d.key === selectedDayKey) ??
    dayBuckets.reduce<DayBucket | null>(
      (acc, d) => (d.total > (acc?.total ?? 0) ? d : acc),
      null
    );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-[40px] text-newTextColor opacity-60">
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-red-400 p-[20px]">Failed to load AI usage data.</div>
    );
  }

  return (
    <div className="flex flex-col gap-[20px] text-newTextColor">
      <div className="flex items-start justify-between flex-wrap gap-[8px]">
        <div>
          <h1 className="text-[22px] font-[600]">{t('AI Usage')}</h1>
          <p className="text-[13px] opacity-60 mt-[4px]">
            {new Date(data.from).toLocaleDateString()} —{' '}
            {new Date(data.to).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-[6px]">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setDays(p)}
              className={adminSegment(days === p)}
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-[12px]">
        {data.byType.map((entry) => (
          <div
            key={entry.type}
            className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]"
          >
            <div className="text-[12px] opacity-60 capitalize">{entry.type}</div>
            <div className="text-[28px] font-[600] mt-[4px]">
              {entry.totalCredits.toLocaleString()}
            </div>
            <div className="text-[12px] opacity-50 mt-[2px]">
              {entry.count.toLocaleString()} calls
            </div>
          </div>
        ))}
      </div>

      {dayBuckets.length > 0 && (
        <div className="bg-white/[0.03] border border-white/10 rounded-[12px] p-[16px]">
          <div className="flex items-baseline justify-between flex-wrap gap-[8px] mb-[12px]">
            <div className="text-[14px] font-[500]">
              {t('ai_usage_per_day', 'Credits used per day')}
            </div>
            <div className="text-[11px] opacity-50">
              {t(
                'ai_usage_per_day_hint',
                'Local time — click a day for its hourly breakdown'
              )}
            </div>
          </div>
          <div className="flex items-end gap-[2px] h-[100px]">
            {dayBuckets.map((day) => {
              const max = Math.max(...dayBuckets.map((d) => d.total), 1);
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => setSelectedDayKey(day.key)}
                  title={`${day.date.toLocaleDateString()}: ${day.total.toLocaleString()}`}
                  className={`flex-1 min-h-[2px] rounded-t-[2px] cursor-pointer transition-colors ${
                    selectedDay?.key === day.key
                      ? 'bg-violet-400'
                      : 'bg-sky-400 hover:bg-sky-300'
                  }`}
                  style={{ height: `${(day.total / max) * 100}%` }}
                />
              );
            })}
          </div>
          <div className="flex gap-[2px] mt-[4px]">
            {dayBuckets.map((day, i) => {
              const labelEvery = Math.max(1, Math.ceil(dayBuckets.length / 12));
              return (
                <div
                  key={day.key}
                  className="flex-1 text-center text-[10px] opacity-50 whitespace-nowrap"
                >
                  {i % labelEvery === 0
                    ? day.date.toLocaleDateString(undefined, {
                        day: '2-digit',
                        month: '2-digit',
                      })
                    : ''}
                </div>
              );
            })}
          </div>
          {selectedDay && (
            <div className="mt-[16px] pt-[12px] border-t border-white/10">
              <div className="text-[12px] opacity-70 mb-[8px]">
                {selectedDay.date.toLocaleDateString(undefined, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
                {' · '}
                {selectedDay.total.toLocaleString()}{' '}
                {t('ai_usage_credits', 'credits')}
              </div>
              <div className="flex items-end gap-[2px] h-[60px]">
                {selectedDay.hours.map((count, hour) => {
                  const hourMax = Math.max(...selectedDay.hours, 1);
                  const label = `${String(hour).padStart(2, '0')}:00`;
                  return (
                    <div
                      key={hour}
                      title={`${label} — ${count.toLocaleString()}`}
                      className="flex-1 bg-sky-400/80 min-h-[1px] rounded-t-[2px]"
                      style={{ height: `${(count / hourMax) * 100}%` }}
                    />
                  );
                })}
              </div>
              <div className="flex gap-[2px] mt-[4px]">
                {selectedDay.hours.map((_, hour) => (
                  <div
                    key={hour}
                    className="flex-1 text-center text-[10px] opacity-50"
                  >
                    {hour % 3 === 0 ? String(hour).padStart(2, '0') : ''}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="bg-white/[0.03] border border-white/10 rounded-[12px] overflow-hidden">
        <div className="px-[16px] py-[12px] border-b border-white/10 text-[14px] font-[500]">
          {t(
            'ai_text_usage',
            'Model usage (observational metering — not billed)'
          )}
        </div>
        <div className="grid grid-cols-[1fr_120px_90px_110px_110px] gap-[12px] px-[16px] py-[8px] text-[11px] uppercase opacity-50 border-b border-white/10">
          <div>Engine</div>
          <div>Model</div>
          <div className="text-right">Calls</div>
          <div className="text-right">In</div>
          <div className="text-right">Out</div>
        </div>
        {!data.text?.byEngine?.length ? (
          <div className="px-[16px] py-[12px] text-[13px] opacity-50">
            {t('ai_text_none', 'No text-AI usage recorded in this range yet.')}
          </div>
        ) : (
          data.text.byEngine.map((row) => (
            <div
              key={`${row.engine}-${row.model}-${row.unit}`}
              className="grid grid-cols-[1fr_120px_90px_110px_110px] gap-[12px] px-[16px] py-[10px] text-[13px] border-b border-white/10 last:border-b-0"
            >
              <div>{row.engine}</div>
              <div className="opacity-60">{row.model}</div>
              <div className="text-right">{row.calls.toLocaleString()}</div>
              <div className="text-right">
                {row.inputAmount.toLocaleString()}
                <span className="opacity-40 ml-[3px]">
                  {UNIT_LABEL[row.unit] ?? 'tok'}
                </span>
              </div>
              <div className="text-right">
                {row.unit === 'tokens'
                  ? `${row.outputAmount.toLocaleString()} tok`
                  : '-'}
              </div>
            </div>
          ))
        )}
        {!!data.text?.topOrgs?.length && (
          <>
            <div className="px-[16px] py-[8px] text-[11px] uppercase opacity-50 border-t border-b border-white/10">
              {t('ai_text_top_orgs', 'Top organizations by tokens')}
            </div>
            {data.text.topOrgs.map((o) => (
              <div
                key={o.orgId ?? 'none'}
                className="grid grid-cols-[1fr_220px] gap-[12px] px-[16px] py-[8px] text-[13px] border-b border-white/10 last:border-b-0"
              >
                <div>{o.orgName}</div>
                <div className="text-right opacity-70">
                  {o.inputTokens.toLocaleString()} in /{' '}
                  {o.outputTokens.toLocaleString()} out
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      <div className="bg-white/[0.03] border border-white/10 rounded-[12px] overflow-hidden">
        <div className="px-[16px] py-[12px] border-b border-white/10 text-[14px] font-[500]">
          {t('Top Organizations by Usage')}
        </div>
        <div className="grid grid-cols-[1fr_140px] gap-[12px] px-[16px] py-[8px] text-[11px] uppercase opacity-50 border-b border-white/10">
          <div>Organization</div>
          <div className="text-right">Credits</div>
        </div>
        {data.topOrgs.length === 0 ? (
          <div className="px-[16px] py-[12px] text-[13px] opacity-50">
            No data available.
          </div>
        ) : (
          data.topOrgs.map((org) => (
            <div
              key={org.orgId}
              className="grid grid-cols-[1fr_140px] gap-[12px] px-[16px] py-[10px] text-[13px] border-b border-white/10 last:border-b-0"
            >
              <div>{org.orgName}</div>
              <div className="text-right">{org.totalCredits.toLocaleString()}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
