'use client';

import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';
import { AdminButton as Button } from './admin-ui';
import { setCookie } from '@gitroom/frontend/components/layout/layout.context';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { ImportDebugPostModal } from '@gitroom/frontend/components/launches/import-debug-post.modal';
import { useToaster } from '@gitroom/react/toaster/toaster';

const Subscription = () => {
  const fetch = useFetch();
  const t = useT();

  const addSubscription: React.ChangeEventHandler<HTMLSelectElement> =
    useCallback(async (e) => {
      const value = e.target.value;
      if (
        await deleteDialog(
          'Are you sure you want to add a user subscription?',
          'Add'
        )
      ) {
        await fetch('/billing/add-subscription', {
          method: 'POST',
          body: JSON.stringify({ subscription: value }),
        });
        window.location.reload();
      }
    }, []);

  return (
    <Select
      onChange={addSubscription}
      hideErrors={true}
      disableForm={true}
      name="sub"
      label=""
      value=""
    >
      <option>
        {t('add_free_subscription', '-- ADD FREE SUBSCRIPTION --')}
      </option>
      {Object.keys(pricing)
        .filter((f) => !f.includes('FREE'))
        .map((key) => (
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
  const [search, setSearch] = useState('');
  // 0-indexed: the backend computes skip = page * limit
  const [page, setPage] = useState(0);
  const limit = 20;
  const { isSecured } = useVariables();
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
      setSearch(e.target.value);
      setPage(0);
    },
    []
  );

  const stopImpersonating = useCallback(async () => {
    if (!isSecured) {
      setCookie('impersonate', '', -10);
    } else {
      const res = await fetch(`/user/impersonate`, {
        method: 'POST',
        body: JSON.stringify({ id: '' }),
      });
      // Reloading regardless meant a failed stop looked exactly like a
      // successful one — the page came back still wearing the other identity
      // (E2E-09-08).
      if (!res.ok) {
        toaster.show(
          t('stop_impersonating_failed', 'Could not stop impersonating.'),
          'warning'
        );
        return;
      }
    }
    window.location.reload();
  }, [toaster, t]);

  const impersonate = useCallback(
    (userOrgId: string) => async () => {
      const res = await fetch(`/user/impersonate`, {
        method: 'POST',
        body: JSON.stringify({ id: userOrgId }),
      });
      if (!res.ok) {
        toaster.show(
          t('impersonate_failed', 'Could not impersonate this user.'),
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
      title: t('import_debug_post', 'Import Debug Post'),
      maxSize: 800,
      children: (close) => <ImportDebugPostModal close={close} />,
    });
  }, []);

  const grantLifetime = useCallback(
    (u: UserItem) => async () => {
      if (
        !(await deleteDialog(
          t(
            'grant_lifetime_confirm',
            `Grant lifetime Business (100 channels, no paywall) to every org owned by ${u.email}?`
          ),
          t('grant', 'Grant')
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
          t('grant_lifetime_failed', 'Failed to grant lifetime'),
          'warning'
        );
        return;
      }
      const report = await res.json();
      toaster.show(
        `${t('grant_lifetime_done', 'Lifetime granted')}: ${
          report.granted.length
        } org(s), ${report.skipped.length} skipped`,
        'success'
      );
      await mutate();
    },
    [t, mutate]
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
                'grant_admin_confirm',
                `Grant super-admin to ${u.email}? This unlocks the Admin panel and god-mode across every org — it takes effect on their next page load.`
              )
            : t(
                'revoke_admin_confirm',
                `Revoke super-admin from ${u.email}? They lose the Admin panel on their next request.`
              ),
          grant
            ? t('grant_admin', 'Grant admin')
            : t('revoke_admin', 'Revoke admin')
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
            ? t('grant_admin_failed', 'Failed to grant admin')
            : t('revoke_admin_failed', 'Failed to revoke admin'),
          'warning'
        );
        return;
      }
      toaster.show(
        grant
          ? t('grant_admin_done', 'Admin granted')
          : t('revoke_admin_done', 'Admin revoked'),
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

      {user?.impersonate && (
        <div className="flex items-center gap-[12px] p-[12px] rounded-[10px] bg-[rgba(56,189,248,0.12)] border border-[rgba(56,189,248,0.3)]">
          <span className="text-[14px]">
            {t('currently_impersonating', 'Currently Impersonating')}
          </span>
          <Button onClick={stopImpersonating} className="!bg-red-600 rounded-[8px] text-[12px]">
            {t('stop_impersonating', 'Stop')}
          </Button>
          {user?.tier?.current === 'FREE' && <Subscription />}
        </div>
      )}

      <div className="flex items-center gap-[12px]">
        <div className="flex-1 max-w-[500px]">
          <Input
            autoComplete="off"
            placeholder={t('search_user_placeholder', 'Search by name or email...')}
            name="user-search"
            disableForm={true}
            label=""
            removeError={true}
            value={search}
            onChange={handleSearch}
          />
        </div>
        <Button onClick={handleImportDebugPost} className="rounded-[8px] text-[12px]">
          {t('import_debug_post', 'Import Debug Post')}
        </Button>
      </div>

      <div className="rounded-[8px] border border-white/10 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="text-left border-b border-white/10 bg-white/[0.03]">
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('email', 'Email')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('name', 'Name')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('activated', 'Activated')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('organizations', 'Organizations')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('created', 'Created')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                {t('last_online', 'Last online')}
              </th>
              <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60" />
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
                  {t('users_load_failed', 'Failed to load users.')}
                </td>
              </tr>
            )}
            {!error && data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="p-[20px] text-center text-[13px] text-newTextColor/40"
                >
                  {t('no_users_found', 'No users found')}
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
                      {t('pending', 'pending')}
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
                        <span className="text-newTextColor/40">
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
                          ? `${t('impersonate', 'Impersonate')} · ${o.organization.name}`
                          : t('impersonate', 'Impersonate')}
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
                        {t('grant_lifetime', 'Grant lifetime')}
                      </button>
                    )}
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
                          ? t('revoke_admin', 'Revoke admin')
                          : t('grant_admin', 'Grant admin')}
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
