'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';

interface OrgSubscription {
  subscriptionTier: string;
  period: string;
  totalChannels: number;
  isLifetime: boolean;
  cancelAt: string | null;
}

interface OrgItem {
  id: string;
  name: string;
  createdAt: string;
  subscription: OrgSubscription | null;
  _count: {
    users: number;
    Integration: number;
    post: number;
  };
}

interface OrgResponse {
  items: OrgItem[];
  total: number;
  page: number;
  limit: number;
}

const tierBadgeColors: Record<string, string> = {
  ULTIMATE: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  PRO: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TEAM: 'bg-green-500/20 text-green-400 border-green-500/30',
  STANDARD: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const defaultBadgeColor = 'bg-red-500/20 text-red-400 border-red-500/30';

export const AdminOrganizationsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [search, setSearch] = useState('');
  // 0-indexed: the backend computes skip = page * limit
  const [page, setPage] = useState(0);
  const limit = 20;

  const load = useCallback(
    async (key: string) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        ...(search ? { search } : {}),
      });
      const res = await fetch(`/admin/organizations?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load organizations');
      return res.json() as Promise<OrgResponse>;
    },
    [page, search]
  );

  const { data, isLoading, error } = useSWR<OrgResponse>(
    `/admin/organizations-${page}-${search}`,
    load,
    {
      // revalidateIfStale stays on: with it off, coming back to this tab
      // inside the same SPA session re-used the cached page and made no
      // request at all, so a tier changed from Users showed the old value
      // until a full reload (E2E-09-15). Measured: two returns, zero fetches.
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      refreshInterval: 0,
    }
  );

  const totalPages = data ? Math.ceil(data.total / limit) : 0;

  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
      setPage(0);
    },
    []
  );

  const tierLabel = (sub: OrgSubscription | null) =>
    sub?.subscriptionTier ?? 'FREE';

  const tierColor = (sub: OrgSubscription | null) => {
    const tier = sub?.subscriptionTier;
    if (!tier) return defaultBadgeColor;
    return tierBadgeColors[tier] ?? defaultBadgeColor;
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <h2 className="text-[20px] font-[600]">
        {t('admin_organizations', 'Organizations')}
      </h2>

      <div className="max-w-[500px]">
        <Input
          autoComplete="off"
          placeholder={t(
            'search_organization_placeholder',
            'Search by name...'
          )}
          name="org-search"
          disableForm={true}
          label=""
          removeError={true}
          value={search}
          onChange={handleSearch}
        />
      </div>

      <div className="rounded-[8px] border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left border-b border-white/10 bg-white/[0.03]">
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('name', 'Name')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('tier', 'Tier')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('period', 'Period')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('channels', 'Channels')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('users', 'Users')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('posts', 'Posts')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('created', 'Created')}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && !data && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/40"
                >
                  {t('loading', 'Loading...')}
                </td>
              </tr>
            )}
            {error && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-red-400"
                >
                  {t(
                    'organizations_load_failed',
                    'Failed to load organizations.'
                  )}
                </td>
              </tr>
            )}
            {!error && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/40"
                >
                  {t('no_organizations_found', 'No organizations found')}
                </td>
              </tr>
            )}
            {data?.items.map((org) => (
              <tr
                key={org.id}
                className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
              >
                <td className="p-[12px] text-[13px] text-newTextColor">
                  {org.name}
                </td>
                <td className="p-[12px] text-[13px]">
                  <span
                    className={`inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-[500] border ${tierColor(org.subscription)}`}
                  >
                    {tierLabel(org.subscription)}
                  </span>
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {org.subscription?.isLifetime
                    ? 'Lifetime'
                    : org.subscription?.period ?? '-'}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {org._count.Integration}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {org._count.users}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {org._count.post}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {new Date(org.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-newTextColor/60">
            {t('page', 'Page')} {page + 1} / {totalPages} ({data?.total}{' '}
            {t('total', 'total')})
          </span>
          <div className="flex gap-[8px]">
            <button
              type="button"
              disabled={page <= 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {t('prev', 'Prev')}
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {t('next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
