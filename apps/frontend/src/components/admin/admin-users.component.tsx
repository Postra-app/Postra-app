'use client';

import React, { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { AdminButton as Button } from './admin-ui';
import { COMPABLE_TIERS } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { ImportDebugPostModal } from '@gitroom/frontend/components/launches/import-debug-post.modal';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDebouncedSearch } from '@gitroom/frontend/components/admin/use-debounced-search';

/**
 * Put an org on a paid tier without a payment.
 *
 * This used to render only while impersonating, inside a panel that is hidden
 * while impersonating, so it was unreachable — and that was the only thing
 * standing between one click and an organization losing its Stripe customer id
 * (E2E-09-02, E2E-09-09). Both are fixed, and the control now names the
 * organization instead of inferring it from whoever the session is wearing.
 */
const CompSubscription: FC<{
  org: UserOrgItem;
  showOrgName: boolean;
  onDone: () => void;
}> = ({ org, showOrgName, onDone }) => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();

  const comp: React.ChangeEventHandler<HTMLSelectElement> = useCallback(
    async (e) => {
      const value = e.target.value;
      if (!value) {
        return;
      }
      e.target.value = '';

      if (
        !(await deleteDialog(
          t(
            'admin_comp_subscription_confirm',
            `Put ${org.organization.name} on ${value} without a payment?`
          ),
          t('admin_comp', 'Comp')
        ))
      ) {
        return;
      }

      const res = await fetch('/admin/comp-subscription', {
        method: 'POST',
        body: JSON.stringify({
          organizationId: org.organization.id,
          subscription: value,
        }),
      });

      if (!res.ok) {
        toaster.show(
          t('admin_comp_subscription_failed', 'Failed to add the subscription'),
          'warning'
        );
        return;
      }

      toaster.show(
        t('admin_comp_subscription_done', 'Subscription added'),
        'success'
      );
      onDone();
    },
    [fetch, toaster, t, org, onDone]
  );

  return (
    <Select
      onChange={comp}
      hideErrors={true}
      disableForm={true}
      name={`comp-${org.id}`}
      label=""
      aria-label={t('admin_comp_subscription', 'Comp a subscription')}
      value=""
    >
      <option value="">
        {showOrgName
          ? `${t('admin_comp_subscription', 'Comp a plan')} · ${
              org.organization.name
            }`
          : t('admin_comp_subscription', 'Comp a plan')}
      </option>
      {COMPABLE_TIERS.map((key) => (
        <option key={key} value={key}>
          {key}
        </option>
      ))}
    </Select>
  );
};

interface UserOrgItem {
  // UserOrganization id — what POST /user/impersonate expects
  id: string;
  role: string;
  organization: {
    id: string;
    name: string;
    subscription: {
      subscriptionTier: string;
      isLifetime: boolean;
    } | null;
  };
}

interface UserItem {
  id: string;
  email: string;
  name: string | null;
  lastName: string | null;
  providerName: string;
  activated: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  lastOnline: string;
  organizations: UserOrgItem[];
}

interface UsersResponse {
  items: UserItem[];
  total: number;
  page: number;
  limit: number;
}

export const AdminUsersComponent = () => {
  const fetch = useFetch();
  const [searchInput, setSearchInput, search] = useDebouncedSearch();
  // 0-indexed: the backend computes skip = page * limit
  const [page, setPage] = useState(0);
  const limit = 20;
  const user = useUser();
  const t = useT();
  const { openModal } = useModals();
  const toaster = useToaster();

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(search ? { search } : {}),
    });
    const res = await fetch(`/admin/users?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to load users');
    return res.json() as Promise<UsersResponse>;
  }, [page, search]);

  const { data, isLoading, error, mutate } = useSWR<UsersResponse>(
    `/admin/users-${page}-${search}`,
    load,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      revalidateIfStale: false,
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

  const impersonate = useCallback(
    (userOrgId: string) => async () => {
      const res = await fetch(`/user/impersonate`, {
        method: 'POST',
        body: JSON.stringify({ id: userOrgId }),
      });
      if (!res.ok) {
        toaster.show(
          t('admin_impersonate_failed', 'Could not impersonate this user.'),
          'warning'
        );
        return;
      }
      window.location.reload();
    },
    [toaster, t]
  );

  const handleImportDebugPost = useCallback(() => {
    openModal({
      title: t('admin_import_debug_post', 'Import Debug Post'),
      maxSize: 800,
      children: (close) => <ImportDebugPostModal close={close} />,
    });
  }, []);

  const grantLifetime = useCallback(
    (u: UserItem) => async () => {
      if (
        !(await deleteDialog(
          t(
            'admin_grant_lifetime_confirm',
            `Grant lifetime Business (100 channels, no paywall) to every org owned by ${u.email}?`
          ),
          t('admin_grant', 'Grant')
        ))
      ) {
        return;
      }
      const res = await fetch('/admin/grant-lifetime', {
        method: 'POST',
        body: JSON.stringify({ email: u.email, apply: true }),
      });
      if (!res.ok) {
        toaster.show(
          t('admin_grant_lifetime_failed', 'Failed to grant lifetime'),
          'warning'
        );
        return;
      }
      const report = await res.json();
      toaster.show(
        `${t('admin_grant_lifetime_done', 'Lifetime granted')}: ${
          report.granted.length
        } org(s), ${report.skipped.length} skipped`,
        'success'
      );
      await mutate();
    },
    [t, mutate]
  );

  // The way back out of a comp or a lifetime grant. Until this existed,
  // granting was a one-way street: the only other route is
  // /billing/cancel-subscription, which needs a live Stripe customer and bails
  // on any lifetime row (E2E-09-41).
  const revokeSubscription = useCallback(
    (u: UserItem, org: UserOrgItem) => async () => {
      if (
        !(await deleteDialog(
          t(
            'admin_revoke_subscription_confirm',
            `Remove the subscription from ${org.organization.name}? It drops to the free tier: channels over the cap are disabled and team seats are reconciled.`
          ),
          t('admin_revoke', 'Revoke')
        ))
      ) {
        return;
      }

      const res = await fetch('/admin/revoke-subscription', {
        method: 'POST',
        body: JSON.stringify({ organizationId: org.organization.id }),
      });
      if (!res.ok) {
        toaster.show(
          t('admin_revoke_subscription_failed', 'Failed to revoke'),
          'warning'
        );
        return;
      }

      toaster.show(
        t('admin_revoke_subscription_done', 'Subscription revoked'),
        'success'
      );
      await mutate();
    },
    [t, mutate, toaster]
  );

  // Super-admin toggle — deliberately separate from Grant lifetime. Lifetime is
  // a full-product subscription with NO admin panel; this flips isSuperAdmin,
  // which is the only thing that unlocks /admin and god-mode.
  const setAdmin = useCallback(
    (u: UserItem) => async () => {
      const grant = !u.isSuperAdmin;
      if (
        !(await deleteDialog(
          grant
            ? t(
                'admin_grant_admin_confirm',
                `Grant super-admin to ${u.email}? This unlocks the Admin panel and god-mode across every org — it takes effect on their next page load.`
              )
            : t(
                'admin_revoke_admin_confirm',
                `Revoke super-admin from ${u.email}? They lose the Admin panel on their next request.`
              ),
          grant
            ? t('admin_grant_admin', 'Grant admin')
            : t('admin_revoke_admin', 'Revoke admin')
        ))
      ) {
        return;
      }
      const res = await fetch('/admin/grant-admin', {
        method: 'POST',
        body: JSON.stringify({ userId: u.id, value: grant }),
      });
      if (!res.ok) {
        toaster.show(
          grant
            ? t('admin_grant_admin_failed', 'Failed to grant admin')
            : t('admin_revoke_admin_failed', 'Failed to revoke admin'),
          'warning'
        );
        return;
      }
      toaster.show(
        grant
          ? t('admin_grant_admin_done', 'Admin granted')
          : t('admin_revoke_admin_done', 'Admin revoked'),
        'success'
      );
      await mutate();
    },
    [t, mutate]
  );

  return (
    <div className="flex flex-col gap-[20px]">
      <h2 className="text-[20px] font-[600]">
        {t('admin_users', 'Users')}
      </h2>

      {/* The "Currently Impersonating / Stop" strip that used to live here was
          unreachable for the same reason the comp control was: the layout
          blocks this whole panel while impersonating. The global banner is the
          Stop button (E2E-09-02, E2E-09-18). */}

      <div className="flex items-center gap-[12px]">
        <div className="flex-1 max-w-[500px]">
          <Input
            autoComplete="off"
            placeholder={t('admin_search_user_placeholder', 'Search by name or email...')}
            name="user-search"
            disableForm={true}
            label=""
            aria-label={t('admin_search_users', 'Search users')}
            removeError={true}
            value={searchInput}
            onChange={handleSearch}
          />
        </div>
        <Button onClick={handleImportDebugPost} className="rounded-[8px] text-[12px]">
          {t('admin_import_debug_post', 'Import Debug Post')}
        </Button>
      </div>

      <div className="rounded-[8px] border border-white/10 overflow-hidden overflow-x-auto">
        <table className="w-full min-w-[810px]">
          <thead>
            <tr className="text-left border-b border-white/10 bg-white/[0.03]">
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_email', 'Email')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_name', 'Name')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_activated', 'Activated')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_organizations', 'Organizations')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_created', 'Created')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('admin_last_online', 'Last online')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60" />
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
                  {t('admin_users_load_failed', 'Failed to load users.')}
                </td>
              </tr>
            )}
            {!error && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/70"
                >
                  {t('admin_no_users_found', 'No users found')}
                </td>
              </tr>
            )}
            {data?.items.map((u) => (
              <tr
                key={u.id}
                className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
              >
                <td className="p-[12px] text-[13px]">
                  {u.email}
                  {u.isSuperAdmin && (
                    <span className="ms-[6px] px-[6px] py-[1px] rounded-[6px] text-[10px] font-[600] bg-[rgba(167,139,250,0.15)] text-[#a78bfa] border border-[rgba(167,139,250,0.3)]">
                      ADMIN
                    </span>
                  )}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {[u.name, u.lastName].filter(Boolean).join(' ') || '-'}
                </td>
                <td className="p-[12px] text-[13px]">
                  {u.activated ? (
                    <span className="text-green-400">✓</span>
                  ) : (
                    <span className="text-amber-400">
                      {t('admin_pending', 'pending')}
                    </span>
                  )}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  <div className="flex flex-wrap gap-[6px]">
                    {u.organizations.map((o) => (
                      <span
                        key={o.id}
                        className="inline-flex items-center gap-[6px] px-[8px] py-[2px] rounded-[6px] text-[11px] border border-white/10 bg-white/[0.03]"
                      >
                        {o.organization.name}
                        <span className="text-newTextColor/70">
                          {o.organization.subscription?.isLifetime
                            ? 'LIFETIME'
                            : o.organization.subscription?.subscriptionTier ??
                              'FREE'}
                        </span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {new Date(u.createdAt).toLocaleDateString()}
                </td>
                <td className="p-[12px] text-[13px] text-newTextColor/60">
                  {new Date(u.lastOnline).toLocaleDateString()}
                </td>
                <td className="p-[12px]">
                  <div className="flex flex-col gap-[4px]">
                    {u.organizations.map((o) => (
                      <Button
                        key={o.id}
                        onClick={impersonate(o.id)}
                        className="rounded-[8px] text-[12px]"
                      >
                        {u.organizations.length > 1
                          ? `${t('admin_impersonate', 'Impersonate')} · ${o.organization.name}`
                          : t('admin_impersonate', 'Impersonate')}
                      </Button>
                    ))}
                    {u.organizations.some(
                      (o) =>
                        o.role === 'SUPERADMIN' &&
                        !o.organization.subscription?.isLifetime
                    ) && (
                      <button
                        type="button"
                        onClick={grantLifetime(u)}
                        className="px-[12px] h-[30px] rounded-[8px] text-[12px] border border-[rgba(167,139,250,0.4)] text-[#a78bfa] hover:bg-[rgba(167,139,250,0.1)] cursor-pointer transition-colors"
                      >
                        {t('admin_grant_lifetime', 'Grant lifetime')}
                      </button>
                    )}
                    {u.organizations
                      .filter(
                        (o) =>
                          o.role === 'SUPERADMIN' && !o.organization.subscription
                      )
                      .map((o) => (
                        <CompSubscription
                          key={`comp-${o.id}`}
                          org={o}
                          showOrgName={u.organizations.length > 1}
                          onDone={mutate}
                        />
                      ))}
                    {u.organizations
                      .filter(
                        (o) =>
                          o.role === 'SUPERADMIN' && !!o.organization.subscription
                      )
                      .map((o) => (
                        <button
                          key={`revoke-${o.id}`}
                          type="button"
                          onClick={revokeSubscription(u, o)}
                          className="px-[12px] h-[30px] rounded-[8px] text-[12px] border border-[rgba(248,113,113,0.4)] text-[#f87171] hover:bg-[rgba(248,113,113,0.1)] cursor-pointer transition-colors"
                        >
                          {u.organizations.length > 1
                            ? `${t(
                                'admin_revoke_subscription',
                                'Revoke subscription'
                              )} · ${o.organization.name}`
                            : t(
                                'admin_revoke_subscription',
                                'Revoke subscription'
                              )}
                        </button>
                      ))}
                    {u.id !== user?.id && (
                      <button
                        type="button"
                        onClick={setAdmin(u)}
                        className={`px-[12px] h-[30px] rounded-[8px] text-[12px] border cursor-pointer transition-colors ${
                          u.isSuperAdmin
                            ? 'border-[rgba(248,113,113,0.4)] text-[#f87171] hover:bg-[rgba(248,113,113,0.1)]'
                            : 'border-[rgba(56,189,248,0.4)] text-[#38bdf8] hover:bg-[rgba(56,189,248,0.1)]'
                        }`}
                      >
                        {u.isSuperAdmin
                          ? t('admin_revoke_admin', 'Revoke admin')
                          : t('admin_grant_admin', 'Grant admin')}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-newTextColor/60">
            {t('admin_page', 'Page')} {page + 1} / {totalPages} ({data?.total}{' '}
            {t('admin_total', 'total')})
          </span>
          <div className="flex gap-[8px]">
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
