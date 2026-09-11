'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

interface SubscriptionOrg {
  id: string;
  name: string;
  paymentId: string | null;
}

interface RecentSubscription {
  id: string;
  subscriptionTier: string;
  period: string;
  totalChannels: number;
  isLifetime: boolean;
  cancelAt: string | null;
  createdAt: string;
  organization: SubscriptionOrg;
}

interface SubscriptionsResponse {
  totalActive: number;
  cancelPending: number;
  noSubscription: number;
  byTier: Array<{ tier: string; count: number }>;
  byPeriod: Array<{ period: string; count: number }>;
  lifetime: number;
  recent: RecentSubscription[];
  stripeTestMode?: boolean;
}

const TIER_COLORS: Record<string, { bg: string; bar: string }> = {
  STANDARD: { bg: 'bg-slate-500/20', bar: 'bg-slate-400' },
  PRO: { bg: 'bg-blue-500/20', bar: 'bg-blue-400' },
  TEAM: { bg: 'bg-green-500/20', bar: 'bg-green-400' },
  ULTIMATE: { bg: 'bg-purple-500/20', bar: 'bg-purple-400' },
};

const fallbackColor = { bg: 'bg-white/10', bar: 'bg-white/40' };

export const AdminSubscriptionsComponent = () => {
  const fetch = useFetch();
  const t = useT();

  const load = useCallback(async () => {
    const res = await fetch('/admin/subscriptions');
    if (!res.ok) throw new Error('Failed to load subscriptions');
    return res.json();
  }, []);

  const { data, isLoading, error } = useSWR<SubscriptionsResponse>(
    '/admin/subscriptions',
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    }
  );

  if (isLoading) {
    return (
      <div className="text-newTextColor/40 py-[40px] text-center text-[14px]">
        Loading...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-red-400 py-[20px] text-center text-[14px]">
        Failed to load subscription data.
      </div>
    );
  }

  const maxTierCount = Math.max(...data.byTier.map((t) => t.count), 1);

  return (
    <div className="flex flex-col gap-[20px] text-newTextColor">
      <h2 className="text-[20px] font-[600]">
        {t('admin_subscriptions', 'Subscriptions')}
      </h2>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-[12px]">
        <MetricCard
          label={t('active_subscriptions', 'Active Subscriptions')}
          value={data.totalActive}
        />
        <MetricCard
          label={t('cancel_pending', 'Cancel Pending')}
          value={data.cancelPending}
        />
        <MetricCard
          label={t('free_no_sub', 'Free (no sub)')}
          value={data.noSubscription}
        />
        <MetricCard
          label={t('lifetime', 'Lifetime')}
          value={data.lifetime}
        />
      </div>

      {/* Breakdowns */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-[12px]">
        {/* By Tier */}
        <div className="border border-white/10 rounded-[12px] bg-white/[0.03] p-[16px] flex flex-col gap-[12px]">
          <div className="text-[14px] font-[500] text-newTextColor/60">
            {t('by_tier', 'By Tier')}
          </div>
          {data.byTier.length === 0 ? (
            <div className="text-[13px] text-newTextColor/30">No data</div>
          ) : (
            data.byTier.map((entry) => {
              const colors = TIER_COLORS[entry.tier] ?? fallbackColor;
              const pct = (entry.count / maxTierCount) * 100;
              return (
                <div key={entry.tier} className="flex flex-col gap-[4px]">
                  <div className="flex items-center justify-between text-[13px]">
                    <span>{entry.tier}</span>
                    <span className="text-newTextColor/50">
                      {entry.count.toLocaleString()}
                    </span>
                  </div>
                  <div className={`h-[6px] rounded-full ${colors.bg}`}>
                    <div
                      className={`h-full rounded-full ${colors.bar}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* By Period */}
        <div className="border border-white/10 rounded-[12px] bg-white/[0.03] p-[16px] flex flex-col gap-[12px]">
          <div className="text-[14px] font-[500] text-newTextColor/60">
            {t('by_period', 'By Period')}
          </div>
          <div className="grid grid-cols-2 gap-[12px]">
            {data.byPeriod.map((entry) => (
              <div
                key={entry.period}
                className="border border-white/10 rounded-[8px] bg-white/[0.03] p-[14px] flex flex-col gap-[4px]"
              >
                <div className="text-[12px] text-newTextColor/50 uppercase">
                  {entry.period}
                </div>
                <div className="text-[24px] font-[600]">
                  {entry.count.toLocaleString()}
                </div>
              </div>
            ))}
            {data.byPeriod.length === 0 && (
              <div className="text-[13px] text-newTextColor/30 col-span-2">
                No data
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Subscriptions table */}
      <div className="border border-white/10 rounded-[12px] overflow-hidden">
        <div className="px-[16px] py-[12px] bg-white/[0.03] border-b border-white/10 text-[14px] font-[500]">
          {t('recent_subscriptions', 'Recent Subscriptions')}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-white/10 bg-white/[0.03]">
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('organization', 'Organization')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('tier', 'Tier')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('period', 'Period')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60 text-right">
                  {t('channels', 'Channels')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60 text-center">
                  {t('lifetime', 'Lifetime')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('cancel_at', 'Cancel At')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('created', 'Created')}
                </th>
                <th className="p-[12px]" />
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-[20px] text-center text-[13px] text-newTextColor/30"
                  >
                    {t('no_recent_subscriptions', 'No recent subscriptions')}
                  </td>
                </tr>
              ) : (
                data.recent.map((sub) => {
                  const tierColor =
                    TIER_COLORS[sub.subscriptionTier]?.bar ?? 'bg-white/40';
                  return (
                    <tr
                      key={sub.id}
                      className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="p-[12px] text-[13px]">
                        {sub.organization.name}
                      </td>
                      <td className="p-[12px] text-[13px]">
                        <span
                          className={`inline-block px-[8px] py-[2px] rounded-full text-[11px] font-[500] ${tierColor} text-white`}
                        >
                          {sub.subscriptionTier}
                        </span>
                      </td>
                      <td className="p-[12px] text-[13px] text-newTextColor/70">
                        {sub.period}
                      </td>
                      <td className="p-[12px] text-[13px] text-right">
                        {sub.totalChannels}
                      </td>
                      <td className="p-[12px] text-[13px] text-center">
                        {sub.isLifetime ? 'Yes' : '-'}
                      </td>
                      <td className="p-[12px] text-[13px] text-newTextColor/50">
                        {sub.cancelAt
                          ? new Date(sub.cancelAt).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="p-[12px] text-[13px] text-newTextColor/50">
                        {new Date(sub.createdAt).toLocaleDateString()}
                      </td>
                      <td className="p-[12px] text-[13px]">
                        {sub.organization.paymentId ? (
                          <a
                            href={`https://dashboard.stripe.com/${
                              data?.stripeTestMode ? 'test/' : ''
                            }customers/${sub.organization.paymentId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#38bdf8] hover:underline whitespace-nowrap"
                          >
                            {t('open_in_stripe', 'Stripe')} ↗
                          </a>
                        ) : (
                          <span className="text-newTextColor/30">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value }: { label: string; value: number }) => (
  <div className="border border-white/10 rounded-[12px] bg-white/[0.03] p-[16px] flex flex-col gap-[4px]">
    <div className="text-[12px] text-newTextColor/50">{label}</div>
    <div className="text-[28px] font-[600]">{value.toLocaleString()}</div>
  </div>
);
