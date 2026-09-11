'use client';

import { FC, useCallback, useState } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { AdminButton as Button, withReason } from './admin-ui';

interface Charge {
  id: string;
  amount: number;
  currency: string;
  created: number;
  status: string;
  refunded: boolean;
  amount_refunded: number;
  description: string | null;
  receipt_url: string | null;
  invoice_pdf: string | null;
}

interface ChargesResponse {
  organizationId: string;
  organizationName: string;
  hasStripeCustomer: boolean;
  charges: Charge[];
}

const money = (amount: number, currency: string) =>
  new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amount / 100);

/**
 * Billing history for one organization, with the two actions that cost money.
 *
 * "The customer wants a refund" was the first request in the panel's gap list
 * and the only red one that touches money: the endpoints were written and
 * tested, and their sole caller was the impersonation panel Postra replaced
 * during a layout rebuild, so the product had no answer at all (05-gaps §1b,
 * §2). Nothing here reaches for the session's organization — it is named, the
 * way comp and revoke name it.
 */
export const AdminBillingModal: FC<{
  organizationId: string;
  organizationName: string;
  close: () => void;
}> = ({ organizationId, organizationName, close }) => {
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [selected, setSelected] = useState<string[]>([]);
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(
      `/admin/charges?organizationId=${encodeURIComponent(organizationId)}`
    );
    if (!res.ok) {
      throw new Error(await withReason(res, 'Failed to load charges'));
    }
    return res.json() as Promise<ChargesResponse>;
  }, [organizationId]);

  const { data, isLoading, error, mutate } = useSWR<ChargesResponse>(
    `/admin/charges-${organizationId}`,
    load,
    { revalidateOnFocus: false }
  );

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  const refundable = (data?.charges ?? []).filter(
    (charge) => !charge.refunded && charge.amount_refunded < charge.amount
  );

  const refund = useCallback(async () => {
    if (!selected.length) {
      return;
    }
    const total = (data?.charges ?? [])
      .filter((charge) => selected.includes(charge.id))
      .reduce((sum, charge) => sum + charge.amount - charge.amount_refunded, 0);
    const currency = data?.charges[0]?.currency ?? 'gbp';

    if (
      !(await deleteDialog(
        t(
          'admin_refund_confirm',
          `Refund ${money(total, currency)} to ${organizationName}? This moves money and cannot be undone here.`
        ),
        t('admin_refund', 'Refund')
      ))
    ) {
      return;
    }

    setWorking(true);
    try {
      const res = await fetch('/admin/refund-charges', {
        method: 'POST',
        body: JSON.stringify({ organizationId, chargeIds: selected }),
      });
      if (!res.ok) {
        toaster.show(
          await withReason(res, t('admin_refund_failed', 'Refund failed')),
          'warning'
        );
        return;
      }
      // The service refunds what it can and reports the rest, so say which is
      // which rather than calling a partial result a success.
      const result = (await res.json()) as {
        refunded: string[];
        failed: string[];
      };
      if (result.failed.length) {
        toaster.show(
          `${t('admin_refunded', 'Refunded')} ${result.refunded.length}, ${t(
            'admin_refund_failed_count',
            'failed'
          )} ${result.failed.length}`,
          'warning'
        );
      } else {
        toaster.show(
          `${t('admin_refunded', 'Refunded')} ${result.refunded.length}`,
          'success'
        );
      }
      setSelected([]);
      await mutate();
    } finally {
      setWorking(false);
    }
  }, [selected, data, organizationId, organizationName, mutate, t, toaster]);

  const cancel = useCallback(async () => {
    if (
      !(await deleteDialog(
        t(
          'admin_cancel_subscription_confirm',
          `Cancel ${organizationName}'s subscription in Stripe, right now? Billing stops and the plan is removed.`
        ),
        t('admin_cancel_subscription', 'Cancel subscription')
      ))
    ) {
      return;
    }

    setWorking(true);
    try {
      const res = await fetch('/admin/cancel-subscription', {
        method: 'POST',
        body: JSON.stringify({ organizationId }),
      });
      if (!res.ok) {
        toaster.show(
          await withReason(
            res,
            t('admin_cancel_subscription_failed', 'Could not cancel')
          ),
          'warning'
        );
        return;
      }
      toaster.show(
        t('admin_cancel_subscription_done', 'Subscription cancelled'),
        'success'
      );
      close();
    } finally {
      setWorking(false);
    }
  }, [organizationId, organizationName, close, t, toaster]);

  return (
    <div className="flex flex-col gap-[16px] text-newTextColor">
      <div className="text-[13px] text-newTextColor/70">{organizationName}</div>

      {isLoading && (
        <div className="text-[13px] text-newTextColor/70">
          {t('admin_loading', 'Loading...')}
        </div>
      )}

      {error && (
        <div className="text-[13px] text-red-400" role="alert">
          {t('admin_charges_load_failed', 'Failed to load billing history.')}
        </div>
      )}

      {!!data && !data.hasStripeCustomer && (
        <div className="text-[13px] text-newTextColor/70">
          {t(
            'admin_no_stripe_customer',
            'This organization has never paid through Stripe, so there is nothing to refund. A comp or a lifetime grant is taken back with Revoke subscription.'
          )}
        </div>
      )}

      {!!data?.charges.length && (
        <div className="border border-white/10 rounded-[12px] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left border-b border-white/10 bg-white/[0.03]">
                  <th className="p-[10px] w-[40px]" />
                  <th className="p-[10px] text-[12px] font-[500] text-newTextColor/60">
                    {t('admin_charge_date', 'Date')}
                  </th>
                  <th className="p-[10px] text-[12px] font-[500] text-newTextColor/60">
                    {t('admin_charge_amount', 'Amount')}
                  </th>
                  <th className="p-[10px] text-[12px] font-[500] text-newTextColor/60">
                    {t('admin_charge_status', 'Status')}
                  </th>
                  <th className="p-[10px] text-[12px] font-[500] text-newTextColor/60">
                    {t('admin_charge_receipt', 'Receipt')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.charges.map((charge) => {
                  const fullyRefunded =
                    charge.refunded || charge.amount_refunded >= charge.amount;
                  return (
                    <tr
                      key={charge.id}
                      className="border-b border-white/5 hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="p-[10px]">
                        <input
                          type="checkbox"
                          aria-label={t('admin_select_charge', 'Select charge')}
                          disabled={fullyRefunded}
                          checked={selected.includes(charge.id)}
                          onChange={() => toggle(charge.id)}
                        />
                      </td>
                      <td className="p-[10px] text-[13px] whitespace-nowrap">
                        {new Date(charge.created * 1000).toLocaleDateString()}
                      </td>
                      <td className="p-[10px] text-[13px] whitespace-nowrap">
                        {money(charge.amount, charge.currency)}
                        {charge.amount_refunded > 0 &&
                          !charge.refunded &&
                          ` (−${money(
                            charge.amount_refunded,
                            charge.currency
                          )})`}
                      </td>
                      <td className="p-[10px] text-[13px] text-newTextColor/70">
                        {fullyRefunded
                          ? t('admin_charge_refunded', 'Refunded')
                          : t('admin_charge_paid', 'Paid')}
                      </td>
                      <td className="p-[10px] text-[13px]">
                        {charge.invoice_pdf || charge.receipt_url ? (
                          <a
                            href={charge.invoice_pdf || charge.receipt_url || ''}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#38bdf8] hover:underline"
                          >
                            {t('admin_charge_open', 'Open')} ↗
                          </a>
                        ) : (
                          <span className="text-newTextColor/50">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!!data && data.hasStripeCustomer && !data.charges.length && (
        <div className="text-[13px] text-newTextColor/70">
          {t('admin_no_charges', 'No successful charges on this customer.')}
        </div>
      )}

      <div className="flex items-center gap-[10px]">
        <Button
          onClick={refund}
          loading={working}
          disabled={!selected.length || !refundable.length}
        >
          {selected.length
            ? `${t('admin_refund', 'Refund')} ${selected.length}`
            : t('admin_refund_selected', 'Refund selected')}
        </Button>
        <Button
          variant="danger"
          onClick={cancel}
          loading={working}
          disabled={!data?.hasStripeCustomer}
        >
          {t('admin_cancel_subscription', 'Cancel subscription')}
        </Button>
      </div>
    </div>
  );
};
