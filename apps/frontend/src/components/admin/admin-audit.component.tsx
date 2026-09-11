'use client';

import { Fragment, useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { adminInput, adminSelect } from './admin-ui';

interface AuditPerson {
  id: string | null;
  email: string | null;
  name?: string | null;
}

interface AuditItem {
  id: string;
  action: string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown> | null;
  actor: AuditPerson | null;
  target: AuditPerson | null;
  organization: { id: string; name: string | null } | null;
}

interface AuditResponse {
  items: AuditItem[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Colour by what the entry is, not by how alarming the word sounds: the two an
// operator scans for are the ones that hand out access or move money.
const actionTone = (action: string) => {
  if (
    action.startsWith('admin.delete') ||
    action === 'billing.refund' ||
    action === 'subscription.cancel'
  ) {
    return 'bg-red-500/20 text-red-300 border-red-500/30';
  }
  if (action.startsWith('admin.impersonate')) {
    return 'bg-amber-500/15 text-amber-300 border-amber-500/40';
  }
  if (action.startsWith('admin.') || action.startsWith('subscription.')) {
    return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
  }
  if (action.startsWith('auth.')) {
    return 'bg-white/10 text-newTextColor/70 border-white/15';
  }
  return 'bg-white/10 text-newTextColor/70 border-white/15';
};

const person = (p: AuditPerson | null) => p?.email ?? p?.id ?? '-';

/**
 * The audit trail, on screen.
 *
 * The writer was put right first — the real admin as the actor rather than
 * whoever the session was wearing, the target recorded beside them, `ip` and
 * `userAgent` filled in — and then nothing read it. "Who put this account on
 * Business, and when" still meant a psql session, which is the same as having
 * no answer when a customer is on the phone (E2E-09-34, 05-gaps §5).
 */
export const AdminAuditComponent = () => {
  const fetch = useFetch();
  const t = useT();
  const [page, setPage] = useState(0);
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 25;

  const load = useCallback(async () => {
    const params = new URLSearchParams({
      page: String(page),
      limit: String(limit),
      ...(action ? { action } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    const res = await fetch(`/admin/audit?${params.toString()}`);
    if (!res.ok) {
      throw new Error('Failed to load the audit trail');
    }
    return res.json() as Promise<AuditResponse>;
  }, [page, action, from, to]);

  const { data, isLoading, error } = useSWR<AuditResponse>(
    `/admin/audit-${page}-${action}-${from}-${to}`,
    load,
    { revalidateOnFocus: false, revalidateOnReconnect: false }
  );

  const loadActions = useCallback(async () => {
    const res = await fetch('/admin/audit/actions');
    if (!res.ok) {
      throw new Error('Failed to load actions');
    }
    return res.json() as Promise<string[]>;
  }, []);

  // Only the actions actually present, so the filter cannot offer an empty
  // result for something that has never happened.
  const { data: actions } = useSWR<string[]>('/admin/audit/actions', loadActions, {
    revalidateOnFocus: false,
  });

  const totalPages = useMemo(
    () => (data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1),
    [data]
  );

  const resetTo = (setter: (value: string) => void) => (value: string) => {
    setter(value);
    setPage(0);
  };

  return (
    <div className="flex flex-col gap-[20px] text-newTextColor">
      <h2 className="text-[20px] font-[600]">{t('admin_audit', 'Audit')}</h2>

      <div className="flex flex-wrap items-end gap-[12px]">
        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">
            {t('admin_audit_action', 'Action')}
          </span>
          <select
            className={adminSelect}
            value={action}
            onChange={(e) => resetTo(setAction)(e.target.value)}
          >
            <option value="">{t('admin_audit_all_actions', 'All actions')}</option>
            {(actions ?? []).map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">{t('admin_from', 'From')}</span>
          <input
            type="date"
            className={adminInput}
            value={from}
            onChange={(e) => resetTo(setFrom)(e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-[6px] text-[13px]">
          <span className="text-newTextColor/70">{t('admin_to', 'To')}</span>
          <input
            type="date"
            className={adminInput}
            value={to}
            onChange={(e) => resetTo(setTo)(e.target.value)}
          />
        </label>

        {(action || from || to) && (
          <button
            type="button"
            className="px-[14px] h-[38px] rounded-[10px] text-[13px] border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] cursor-pointer transition-colors"
            onClick={() => {
              setAction('');
              setFrom('');
              setTo('');
              setPage(0);
            }}
          >
            {t('admin_clear_filters', 'Clear filters')}
          </button>
        )}
      </div>

      <div className="border border-white/10 rounded-[12px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left border-b border-white/10 bg-white/[0.03]">
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_audit_when', 'When')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_audit_action', 'Action')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_audit_actor', 'Actor')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_audit_target', 'Target')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_organization', 'Organization')}
                </th>
                <th className="p-[12px] text-[13px] font-[500] text-newTextColor/60">
                  {t('admin_audit_from_where', 'From')}
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
                    {t('admin_audit_load_failed', 'Failed to load the audit trail.')}
                  </td>
                </tr>
              )}
              {!error && !isLoading && data?.items.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="p-[20px] text-center text-[13px] text-newTextColor/70"
                  >
                    {t('admin_audit_empty', 'Nothing recorded for this filter')}
                  </td>
                </tr>
              )}
              {data?.items.map((item) => (
                <Fragment key={item.id}>
                  <tr className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                    <td className="p-[12px] text-[13px] text-newTextColor/70 whitespace-nowrap">
                      {new Date(item.createdAt).toLocaleString()}
                    </td>
                    <td className="p-[12px] text-[13px]">
                      <span
                        className={`inline-block px-[8px] py-[2px] rounded-[6px] text-[11px] font-[500] border ${actionTone(
                          item.action
                        )}`}
                      >
                        {item.action}
                      </span>
                    </td>
                    <td className="p-[12px] text-[13px]">{person(item.actor)}</td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70">
                      {person(item.target)}
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/70">
                      {item.organization?.name ?? '-'}
                    </td>
                    <td className="p-[12px] text-[13px] text-newTextColor/60 whitespace-nowrap">
                      {item.ip ?? '-'}
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
                          ? t('admin_audit_hide', 'Hide')
                          : t('admin_audit_details', 'Details')}
                      </button>
                    </td>
                  </tr>
                  {expanded === item.id && (
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <td colSpan={7} className="p-[12px]">
                        <div className="flex flex-col gap-[8px] text-[12px]">
                          <div className="text-newTextColor/60 break-all">
                            {t('admin_audit_user_agent', 'User agent')}:{' '}
                            {item.userAgent ?? '-'}
                          </div>
                          <pre className="bg-black/30 border border-white/10 rounded-[8px] p-[10px] overflow-x-auto text-newTextColor/80">
                            {JSON.stringify(item.metadata ?? {}, null, 2)}
                          </pre>
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
