'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  adminInput,
  adminSelect,
  channelStateBadgeClass,
  formatExpiry,
} from './admin-ui';
import {
  CHANNEL_STATE_COPY,
  CHANNEL_STATES,
  ChannelState,
} from '@gitroom/nestjs-libraries/database/prisma/integrations/channel.state';

interface ChannelItem {
  id: string;
  internalId: string;
  name: string;
  picture: string | null;
  provider: string;
  profile: string | null;
  state: ChannelState;
  flags: {
    refreshNeeded: boolean;
    disabled: boolean;
    inBetweenSteps: boolean;
  };
  scheduled: boolean;
  actionable: boolean;
  tokenExpiration: string | null;
  expiresInSeconds: number | null;
  grantedScopes: string[] | null;
  commentScope: string | null;
  commentCapable: boolean;
  customer: { id: string; name: string } | null;
  organization: { id: string; name: string | null };
  createdAt: string;
  updatedAt: string | null;
  deletedAt: string | null;
  recentErrors: number;
  recentErrorDays: number;
  lastError: { message: string; at: string } | null;
}

interface ChannelsResponse {
  items: ChannelItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  summary: Record<string, number>;
}

interface ProviderRow {
  provider: string;
  channels: number;
  scheduled: boolean;
}

/**
 * Channels, and the state of the tokens behind them.
 *
 * The last of the six customer requests the panel could not answer: "my
 * channel keeps disconnecting" (05-gaps §1e). Until now the only way to see
 * any of this was running the refresh command over SSM, and that output read
 * as an incident when it was describing a healthy account (E2E-09-59).
 *
 * So the header leads with the one number worth acting on and says in words
 * why a channel expiring within the day is usually nothing — the sentence is
 * the feature, not decoration.
 */
/**
 * What else is set on this channel beyond the one word on the badge.
 *
 * `state` reports the first rule that matched, by design — the order is the
 * order of what to tell the customer. That makes a second flag invisible: a
 * channel switched off after a downgrade that also failed its refresh reads
 * only as "Disabled". The advice is still right, but the operator should be
 * able to see the rest.
 */
const alsoTrue = (item: ChannelItem): string[] => {
  const also: string[] = [];
  if (item.flags?.disabled && item.state !== 'disabled') {
    also.push('switched off');
  }
  if (item.flags?.refreshNeeded && item.state !== 'needs-reconnect') {
    also.push('a refresh has failed');
  }
  if (item.flags?.inBetweenSteps && item.state !== 'setup-incomplete') {
    also.push('the connect flow never finished');
  }
  return also;
};

export const AdminChannelsComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const params = useSearchParams();

  // Organizations links here with the org already chosen, so the drill-down
  // costs no second component.
  const [organizationId, setOrganizationId] = useState(
    params?.get('organizationId') ?? ''
  );
  const [page, setPage] = useState(0);
  const [state, setState] = useState('');
  const [provider, setProvider] = useState('');
  const [search, setSearch] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 25;

  const load = useCallback(async () => {
    const query = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(organizationId ? { organizationId } : {}),
      ...(state ? { state } : {}),
      ...(provider ? { provider } : {}),
      ...(search ? { search } : {}),
      ...(includeDeleted ? { includeDeleted: 'true' } : {}),
    });
    const res = await fetch(`/admin/integrations?${query.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to load channels');
    }
    return res.json() as Promise<ChannelsResponse>;
  }, [page, organizationId, state, provider, search, includeDeleted]);

  const { data, isLoading, error } = useSWR<ChannelsResponse>(
    `/admin/channels-${page}-${organizationId}-${state}-${provider}-${search}-${includeDeleted}`,
    load,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  // Scoped like the table, or the options describe a different set than the
  // one on screen.
  const providerQuery = new URLSearchParams({
    ...(organizationId ? { organizationId } : {}),
    ...(includeDeleted ? { includeDeleted: 'true' } : {}),
  }).toString();

  const loadProviders = useCallback(async () => {
    const res = await fetch(
      `/admin/integrations/providers${providerQuery ? `?${providerQuery}` : ''}`
    );
    if (!res.ok) {
      throw new Error('Failed to load providers');
    }
    return res.json() as Promise<ProviderRow[]>;
  }, [providerQuery]);

  const { data: providers } = useSWR<ProviderRow[]>(
    `/admin/integrations/providers?${providerQuery}`,
    loadProviders,
    { revalidateOnFocus: false }
  );

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1),
    [data]
  );

  const resetTo = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
  };

  const summary = data?.summary ?? {};
  const filtered =
    !!organizationId || !!state || !!provider || !!search || includeDeleted;

  return (
    <div className="flex flex-col gap-[20px] text-newTextColor">
      <h2 className="text-[20px] font-[600]">
        {t('admin_channels', 'Channels')}
      </h2>

      {/* The counts an operator acts on, and the ones that only look alarming,
          kept visually apart on purpose. */}
      <div className="flex flex-wrap gap-[12px]">
        <div className="flex-1 min-w-[180px] border border-white/10 rounded-[12px] p-[14px] bg-white/[0.02]">
          <div className="text-[26px] font-[600] leading-[1.1]">
            {summary.actionable ?? 0}
          </div>
          <div className="text-[13px] text-newTextColor/70 mt-[4px]">
            {t('admin_channels_actionable', 'Need attention')}
          </div>
          <div className="text-[11.5px] text-newTextColor/60 mt-[6px]">
            {t(
              'admin_channels_actionable_hint',
              'A failed refresh, an unfinished setup, or a dead token on a channel no scheduled refresh watches.'
            )}
          </div>
        </div>

        <div className="flex-1 min-w-[180px] border border-white/10 rounded-[12px] p-[14px] bg-white/[0.02]">
          <div className="text-[26px] font-[600] leading-[1.1]">
            {summary['needs-reconnect'] ?? 0}
          </div>
          <div className="text-[13px] text-newTextColor/70 mt-[4px]">
            {t('admin_channels_reconnect', 'Need reconnect')}
          </div>
          <div className="text-[11.5px] text-newTextColor/60 mt-[6px]">
            {t(
              'admin_channels_reconnect_hint',
              'The customer has to connect these again — nothing on our side will fix them.'
            )}
          </div>
        </div>

        <div className="flex-1 min-w-[180px] border border-white/10 rounded-[12px] p-[14px] bg-white/[0.02]">
          <div className="text-[26px] font-[600] leading-[1.1] text-newTextColor/70">
            {summary.expiring ?? 0}
          </div>
          <div className="text-[13px] text-newTextColor/70 mt-[4px]">
            {t('admin_channels_expiring', 'Expire within 24h')}
          </div>
          <div className="text-[11.5px] text-newTextColor/60 mt-[6px]">
            {t(
              'admin_channels_expiring_hint',
              'Normal. YouTube tokens last about an hour and TikTok about a day, and both refresh themselves on the next publish.'
            )}
          </div>
        </div>

        <div className="flex-1 min-w-[180px] border border-white/10 rounded-[12px] p-[14px] bg-white/[0.02]">
          <div className="text-[26px] font-[600] leading-[1.1] text-newTextColor/70">
            {summary.disabled ?? 0}
          </div>
          <div className="text-[13px] text-newTextColor/70 mt-[4px]">
            {t('admin_channels_disabled', 'Switched off')}
          </div>
          <div className="text-[11.5px] text-newTextColor/60 mt-[6px]">
            {t(
              'admin_channels_disabled_hint',
              'Over the plan channel limit, or disabled by hand. The answer is the plan, not a reconnect.'
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-[12px]">
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">
            {t('admin_channels_state', 'State')}
          </span>
          <select
            className={adminSelect}
            value={state}
            onChange={(e) => resetTo(setState)(e.target.value)}
          >
            <option value="">{t('admin_channels_any_state', 'Any state')}</option>
            {CHANNEL_STATES.map((value) => (
              <option key={value} value={value}>
                {CHANNEL_STATE_COPY[value].label}
                {summary[value] === undefined ? '' : ` (${summary[value]})`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">
            {t('admin_channels_provider', 'Provider')}
          </span>
          <select
            className={adminSelect}
            value={provider}
            onChange={(e) => resetTo(setProvider)(e.target.value)}
          >
            <option value="">
              {t('admin_channels_any_provider', 'Any provider')}
            </option>
            {(providers ?? []).map((row) => (
              <option key={row.provider} value={row.provider}>
                {row.provider} ({row.channels})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">
            {t('admin_channels_search', 'Channel or organization')}
          </span>
          <input
            className={adminInput}
            value={search}
            placeholder={t('admin_channels_search_hint', 'Name contains…')}
            onChange={(e) => resetTo(setSearch)(e.target.value)}
          />
        </label>

        <label className="flex items-center gap-[8px] text-[13px] h-[38px]">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(e) => {
              setIncludeDeleted(e.target.checked);
              setPage(0);
            }}
          />
          <span className="text-newTextColor/70">
            {t('admin_channels_include_deleted', 'Include deleted')}
          </span>
        </label>

        {filtered && (
          <button
            type="button"
            className="px-[14px] h-[38px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer transition-colors"
            onClick={() => {
              setState('');
              setProvider('');
              setSearch('');
              setOrganizationId('');
              setIncludeDeleted(false);
              setPage(0);
            }}
          >
            {t('admin_clear_filters', 'Clear filters')}
          </button>
        )}
      </div>

      {!!organizationId && (
        <div className="text-[13px] text-newTextColor/70">
          {t('admin_channels_one_org', 'Showing one organization only.')}{' '}
          <span className="text-newTextColor/60">{organizationId}</span>
        </div>
      )}

      <div className="border border-white/10 rounded-[12px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-white/10 bg-white/[0.03]">
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_channels_channel', 'Channel')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_organization', 'Organization')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_channels_state', 'State')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_channels_token', 'Token')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_channels_refresh', 'Refresh')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_channels_failures', 'Failures 30d')}
                </th>
                <th className="p-[12px]" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
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
                    {t('admin_channels_load_failed', 'Failed to load channels.')}
                  </td>
                </tr>
              )}
              {!error && !isLoading && data?.items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-[20px] text-center text-[13px] text-newTextColor/70"
                  >
                    {t('admin_channels_empty', 'No channel matches this filter')}
                  </td>
                </tr>
              )}
              {data?.items.map((item) => (
                <Fragment key={item.id}>
                  <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="p-[12px] text-[13px]">
                      <div className="font-[500]">{item.name}</div>
                      <div className="text-[11.5px] text-newTextColor/60">
                        {item.provider}
                        {item.customer ? ` · ${item.customer.name}` : ''}
                      </div>
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70">
                      {item.organization?.name ?? '-'}
                    </td>
                    <td className="p-[12px] text-[13px]">
                      <span
                        className={channelStateBadgeClass(item.state)}
                        title={CHANNEL_STATE_COPY[item.state]?.hint}
                      >
                        {CHANNEL_STATE_COPY[item.state]?.label ?? item.state}
                      </span>
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70 whitespace-nowrap">
                      {formatExpiry(item.expiresInSeconds)}
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70 whitespace-nowrap">
                      {item.scheduled
                        ? t('admin_channels_scheduled', 'Scheduled')
                        : t('admin_channels_reactive', 'On publish')}
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70">
                      {item.recentErrors || '-'}
                    </td>
                    <td className="p-[12px] text-[13px]">
                      <button
                        type="button"
                        aria-expanded={expanded === item.id}
                        onClick={() =>
                          setExpanded((current) =>
                            current === item.id ? null : item.id
                          )
                        }
                        className="px-[10px] h-[30px] rounded-[8px] text-[12px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer transition-colors"
                      >
                        {expanded === item.id
                          ? t('admin_channels_hide', 'Hide')
                          : t('admin_channels_details', 'Details')}
                      </button>
                    </td>
                  </tr>
                  {expanded === item.id && (
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <td colSpan={7} className="p-[12px]">
                        <div className="flex flex-col gap-[8px] text-[12px] text-newTextColor/70">
                          <div>{CHANNEL_STATE_COPY[item.state]?.hint}</div>
                          {/* The badge shows the first rule that matched, so
                              anything else that is also true says so here
                              rather than disappearing behind it. */}
                          {alsoTrue(item).length > 0 && (
                            <div>
                              {t('admin_channels_also', 'Also true')}:{' '}
                              {alsoTrue(item).join(', ')}
                            </div>
                          )}
                          <div>
                            {t('admin_channels_expires_at', 'Expires')}:{' '}
                            {item.tokenExpiration
                              ? new Date(item.tokenExpiration).toLocaleString()
                              : t(
                                  'admin_channels_no_expiry',
                                  'this provider never reports an expiry'
                                )}
                          </div>
                          <div className="break-all">
                            {t('admin_channels_platform_id', 'Platform id')}:{' '}
                            {item.internalId}
                          </div>
                          <div>
                            {t('admin_channels_first_comment', 'First comment')}:{' '}
                            {item.commentCapable
                              ? t('admin_channels_comment_yes', 'available')
                              : t(
                                  'admin_channels_comment_no',
                                  'not available on this channel'
                                )}
                            {item.commentScope
                              ? ` (${t(
                                  'admin_channels_comment_scope',
                                  'needs'
                                )} ${item.commentScope})`
                              : ''}
                          </div>
                          {/* Never recorded and granted nothing are different
                              answers to "would reconnecting help". */}
                          <div className="break-all">
                            {t('admin_channels_scopes', 'Granted scopes')}:{' '}
                            {item.grantedScopes === null
                              ? t(
                                  'admin_channels_scopes_unknown',
                                  'never recorded — this channel predates the column, so a reconnect would fill it in'
                                )
                              : item.grantedScopes.length
                              ? item.grantedScopes.join(', ')
                              : t(
                                  'admin_channels_scopes_none',
                                  'the platform granted none'
                                )}
                          </div>
                          {!!item.lastError && (
                            <div className="break-all">
                              {t('admin_channels_last_failure', 'Last failure')}:{' '}
                              {new Date(item.lastError.at).toLocaleString()} —{' '}
                              {item.lastError.message}
                            </div>
                          )}
                          <div>
                            {t('admin_channels_connected', 'Connected')}:{' '}
                            {new Date(item.createdAt).toLocaleString()}
                            {item.deletedAt
                              ? ` · ${t(
                                  'admin_channels_deleted_at',
                                  'deleted'
                                )} ${new Date(item.deletedAt).toLocaleString()}`
                              : ''}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

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
