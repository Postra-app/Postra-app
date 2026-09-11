'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { useDebouncedSearch } from '@gitroom/frontend/components/admin/use-debounced-search';

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

// FREE is the commonest tier there is, and it was falling through to the
// error colour — a panel full of red badges for accounts that are perfectly
// fine. Red is kept for a tier the map genuinely does not know (E2E-09-29).
const freeBadgeColor = 'bg-white/10 text-newTextColor/70 border-white/15';
const defaultBadgeColor = 'bg-red-500/20 text-red-400 border-red-500/30';

export const AdminOrganizationsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [searchInput, setSearchInput, search] = useDebouncedSearch();
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
      setSearchInput(e.target.value);
      setPage(0);
    },
    [setSearchInput]
  );

  const tierLabel = (sub: OrgSubscription | null) =>
    sub?.subscriptionTier ?? 'FREE';

  const tierColor = (sub: OrgSubscription | null) => {
    const tier = sub?.subscriptionTier;
    if (!tier) return defaultBadgeColor;
    if (tier === 'FREE') {
      return freeBadgeColor;
    }
    return tierBadgeColors[tier] ?? defaultBadgeColor;
  };

  return (
    <div className="flex flex-col gap-[20px]">
      <h1 className="text-[20px] font-[600]">
        {t('admin_organizations', 'Organizations')}
      </h1>

      <div className="max-w-[500px]">
        <Input
          autoComplete="off"
          placeholder={t(
            'admin_search_organization_placeholder',
            'Search by name...'
          )}
          name="org-search"
          disableForm={true}
          // label="" makes the shared Input skip its label block entirely, so
          // the field reached a screen reader with nothing but a placeholder
          // (E2E-09-13).
          label=""
          aria-label={t('admin_search_organizations', 'Search organizations')}
          removeError={true}
          value={searchInput}
          onChange={handleSearch}
        />
      </div>

      <div className="rounded-[8px] border border-white/10 overflow-hidden overflow-x-auto">
        {/* overflow-x-auto, not overflow-hidden: the app shell clips its own
            overflow, so anything past the edge was unreachable rather than
            scrollable (E2E-09-49). */}
        <table className="w-full min-w-[560px]">
          <thead>
            <tr className="text-left border-b border-white/10 bg-white/[0.03]">
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_name', 'Name')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_tier', 'Tier')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_period', 'Period')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_channels', 'Channels')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_users', 'Users')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {/* Every post the org has ever created, drafts and failures
                    included. Stats and Growth both count published posts under
                    the same word, and the two numbers never agree
                    (E2E-09-25). */}
                {t('admin_posts_all', 'Posts (all)')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_created', 'Created')}
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading && !data && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/70"
                >
                  {t('admin_loading', 'Loading...')}
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
                    'admin_organizations_load_failed',
                    'Failed to load organizations.'
                  )}
                </td>
              </tr>
            )}
            {!error && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/70"
                >
                  {t('admin_no_organizations_found', 'No organizations found')}
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

      {/* The whole block, count included, used to be hidden when everything
          fitted on one page — so the number of organizations was invisible in
          the one state where it is easiest to read (E2E-09-29). */}
      {!!data && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-newTextColor/60">
            {totalPages > 1
              ? `${t('admin_page', 'Page')} ${page + 1} / ${totalPages} (${
                  data.total
                } ${t('admin_total', 'total')})`
              : `${data.total} ${t('admin_total', 'total')}`}
          </span>
          <div className={totalPages > 1 ? 'flex gap-[8px]' : 'hidden'}>
            <button
              type="button"
              disabled={page <= 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {t('admin_prev', 'Prev')}
            </button>
            <button
              type="button"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
              className="px-[14px] h-[34px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/25 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer transition-colors"
            >
              {t('admin_next', 'Next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
