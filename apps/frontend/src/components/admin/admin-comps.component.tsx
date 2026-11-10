'use client';

import React, { FC, FormEvent, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import {
  COMPABLE_TIERS,
  COMP_MONTHS,
  COMP_REASONS,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  AdminButton as Button,
  adminInput,
  adminSelect,
  tierBadgeClass,
  tierName,
  withReason,
} from './admin-ui';

interface CompRow {
  organizationId: string;
  subscriptionTier: string;
  compReason: string | null;
  compEndsAt: string | null;
  createdAt: string;
  organization: { name: string };
}

interface PendingRow {
  id: string;
  email: string;
  tier: string;
  months: number | null;
  reason: string;
  createdAt: string;
  consumedAt: string | null;
  organizationId: string | null;
}

interface CompsResponse {
  comps: CompRow[];
  pending: PendingRow[];
}

// Day only, in the admin's locale: an end date has no time that matters.
export const compDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString() : '';

// Fewer than 8 days left: the row is highlighted so an extension is not missed.
export const endsSoon = (iso: string | null, now = Date.now()) =>
  !!iso && new Date(iso).getTime() - now < 8 * 86_400_000;

export const lengthLabel = (months: number | null) =>
  months ? `${months} mo` : 'until revoked';

/** Length and reason pickers shared by the comp controls. */
export const CompTermsFields: FC<{
  months: string;
  reason: string;
  onMonths: (v: string) => void;
  onReason: (v: string) => void;
  idPrefix: string;
}> = ({ months, reason, onMonths, onReason, idPrefix }) => {
  const t = useT();
  return (
    <>
      <select
        className={adminSelect}
        aria-label={t('admin_comp_length', 'Length')}
        id={`${idPrefix}-months`}
        value={months}
        onChange={(e) => onMonths(e.target.value)}
      >
        {COMP_MONTHS.map((m) => (
          <option key={m} value={String(m)}>
            {lengthLabel(m)}
          </option>
        ))}
        <option value="">{lengthLabel(null)}</option>
      </select>
      <select
        className={adminSelect}
        aria-label={t('admin_comp_reason', 'Reason')}
        id={`${idPrefix}-reason`}
        value={reason}
        onChange={(e) => onReason(e.target.value)}
      >
        {COMP_REASONS.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
    </>
  );
};

/**
 * Plans nobody pays for: comps in force with their end dates, and comps
 * promised to an email before its account exists (influencers send only
 * their address; the plan is there the moment they sign up).
 */
export const AdminCompsComponent = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();

  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<string>('PRO');
  const [months, setMonths] = useState('3');
  const [reason, setReason] = useState<string>('influencer');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/admin/comps');
    if (!res.ok) throw new Error('Failed to load comps');
    return res.json();
  }, [fetch]);

  const { data, error, mutate } = useSWR<CompsResponse>('/admin/comps', load, {
    revalidateOnFocus: false,
  });

  const promise = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!email.trim() || busy) return;
      setBusy(true);
      try {
        const res = await fetch('/admin/pending-grants', {
          method: 'POST',
          body: JSON.stringify({
            email: email.trim(),
            subscription: tier,
            months: months ? Number(months) : null,
            reason,
          }),
        });
        if (!res.ok) {
          toaster.show(
            await withReason(
              res,
              t('admin_pending_grant_failed', 'Could not save the grant')
            ),
            'warning'
          );
          return;
        }
        toaster.show(
          t(
            'admin_pending_grant_done',
            'Saved: the plan is applied when this email signs up'
          ),
          'success'
        );
        setEmail('');
        mutate();
      } finally {
        setBusy(false);
      }
    },
    [email, tier, months, reason, busy, fetch, toaster, t, mutate]
  );

  const remove = useCallback(
    (row: PendingRow) => async () => {
      if (
        !(await deleteDialog(
          t(
            'admin_pending_grant_delete_confirm',
            `Delete the waiting grant for ${row.email}?`
          ),
          t('admin_delete', 'Delete')
        ))
      ) {
        return;
      }
      const res = await fetch(`/admin/pending-grants/${row.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        toaster.show(
          await withReason(
            res,
            t('admin_pending_grant_delete_failed', 'Could not delete the grant')
          ),
          'warning'
        );
        return;
      }
      mutate();
    },
    [fetch, toaster, t, mutate]
  );

  return (
    <div className="flex flex-col gap-[20px] text-newTextColor">
      <h2 className="text-[20px] font-[600]">
        {t('admin_comps', 'Comps')}
      </h2>

      <form
        onSubmit={promise}
        className="border border-white/10 rounded-[12px] bg-white/[0.03] p-[16px] flex flex-col gap-[12px]"
        aria-label={t('admin_pending_grant_form', 'Promise a plan to an email')}
      >
        <div className="text-[14px] font-[500] text-newTextColor/60">
          {t('admin_pending_grant_form', 'Promise a plan to an email')}
        </div>
        <div className="text-[13px] text-newTextColor/70">
          {t(
            'admin_pending_grant_help',
            'For someone without an account yet: when this email signs up, its organization gets the plan at once and never sees the plan page. For an existing account, use Comp a plan in Users.'
          )}
        </div>
        <div className="flex flex-wrap gap-[8px] items-center">
          <input
            type="email"
            required
            className={`${adminInput} min-w-[240px] flex-1`}
            placeholder="name@example.com"
            aria-label={t('admin_email', 'Email')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <select
            className={adminSelect}
            aria-label={t('admin_plan', 'Plan')}
            value={tier}
            onChange={(e) => setTier(e.target.value)}
          >
            {COMPABLE_TIERS.map((key) => (
              <option key={key} value={key}>
                {tierName(key)}
              </option>
            ))}
          </select>
          <CompTermsFields
            months={months}
            reason={reason}
            onMonths={setMonths}
            onReason={setReason}
            idPrefix="pending"
          />
          <Button type="submit" disabled={busy} className="rounded-[8px]">
            {t('admin_pending_grant_save', 'Save grant')}
          </Button>
        </div>
      </form>

      {error ? (
        <div className="text-red-400 text-[14px]">
          {t('admin_comps_failed', 'Failed to load comps.')}
        </div>
      ) : !data ? (
        <div className="text-newTextColor/70 text-[14px]">Loading...</div>
      ) : (
        <>
          <div className="border border-white/10 rounded-[12px] bg-white/[0.03] overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="text-start p-[12px] text-[14px] font-[500] text-newTextColor/60">
                {t('admin_comps_in_force', 'Comps in force')} ({data.comps.length})
              </caption>
              <thead>
                <tr className="text-newTextColor/60 text-start">
                  <th className="p-[12px] text-start">{t('admin_organization', 'Organization')}</th>
                  <th className="p-[12px] text-start">{t('admin_plan', 'Plan')}</th>
                  <th className="p-[12px] text-start">{t('admin_comp_reason', 'Reason')}</th>
                  <th className="p-[12px] text-start">{t('admin_comp_ends', 'Ends')}</th>
                </tr>
              </thead>
              <tbody>
                {data.comps.map((c) => (
                  <tr key={c.organizationId} className="border-t border-white/10">
                    <td className="p-[12px]">{c.organization.name}</td>
                    <td className="p-[12px]">
                      <span className={tierBadgeClass(c.subscriptionTier)}>
                        {tierName(c.subscriptionTier)}
                      </span>
                    </td>
                    <td className="p-[12px]">{c.compReason ?? '—'}</td>
                    <td
                      className={`p-[12px] ${
                        endsSoon(c.compEndsAt) ? 'text-[#fbbf24] font-[600]' : ''
                      }`}
                    >
                      {c.compEndsAt ? compDay(c.compEndsAt) : lengthLabel(null)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="border border-white/10 rounded-[12px] bg-white/[0.03] overflow-x-auto">
            <table className="w-full text-[13px]">
              <caption className="text-start p-[12px] text-[14px] font-[500] text-newTextColor/60">
                {t('admin_pending_grants', 'Promised to an email')} ({data.pending.length})
              </caption>
              <thead>
                <tr className="text-newTextColor/60">
                  <th className="p-[12px] text-start">{t('admin_email', 'Email')}</th>
                  <th className="p-[12px] text-start">{t('admin_plan', 'Plan')}</th>
                  <th className="p-[12px] text-start">{t('admin_comp_length', 'Length')}</th>
                  <th className="p-[12px] text-start">{t('admin_comp_reason', 'Reason')}</th>
                  <th className="p-[12px] text-start">{t('admin_status', 'Status')}</th>
                  <th className="p-[12px]" />
                </tr>
              </thead>
              <tbody>
                {data.pending.map((p) => (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="p-[12px]">{p.email}</td>
                    <td className="p-[12px]">{tierName(p.tier)}</td>
                    <td className="p-[12px]">{lengthLabel(p.months)}</td>
                    <td className="p-[12px]">{p.reason}</td>
                    <td className="p-[12px]">
                      {p.consumedAt
                        ? `${t('admin_pending_grant_applied', 'Applied')} ${compDay(p.consumedAt)}`
                        : t('admin_pending_grant_waiting', 'Waiting for sign-up')}
                    </td>
                    <td className="p-[12px] text-end">
                      {!p.consumedAt && (
                        <button
                          type="button"
                          onClick={remove(p)}
                          className="px-[12px] h-[30px] rounded-[8px] text-[12px] border border-[rgba(248,113,113,0.4)] text-[#f87171] hover:bg-[rgba(248,113,113,0.1)] cursor-pointer transition-colors"
                        >
                          {t('admin_delete', 'Delete')}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};
