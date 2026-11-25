'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TrialLimitsNote } from '@gitroom/frontend/components/billing/trial.limits.note';

// What a new account is told about the free week on the plan screen, shown
// only when the checkout really has one.

export const PAYMENT_FORM_ID = 'payment-form';

/** Under the plans: what the chosen plan costs today and after the week. */
export const TrialPriceLine: FC<{
  price: number;
  period: 'MONTHLY' | 'YEARLY';
}> = ({ price, period }) => {
  const t = useT();
  return (
    <div
      data-testid="trial-price-line"
      className="mt-[16px] text-[16px] font-[600]"
    >
      {period === 'MONTHLY'
        ? t(
            'billing_trial_price_month',
            '£0 today. 7 days free, then £{{price}} / month.',
            { price }
          )
        : t(
            'billing_trial_price_year',
            '£0 today. 7 days free, then £{{price}} / year.',
            { price }
          )}
    </div>
  );
};

/**
 * The next step on a phone or tablet, where the card form sits under the
 * plans and the whole feature list.
 */
export const StartTrialButton: FC = () => {
  const t = useT();
  return (
    <button
      type="button"
      className="hidden tablet:flex mt-[16px] h-[52px] w-full items-center justify-center rounded-[12px] bg-[#618DFF] text-[16px] font-[700] text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      onClick={() =>
        document
          .getElementById(PAYMENT_FORM_ID)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    >
      {t('billing_start_trial', 'Start 7-day free trial')}
    </button>
  );
};

/** Above the card form. */
export const NotChargedToday: FC = () => {
  const t = useT();
  return (
    <div
      data-testid="not-charged-today"
      className="mt-[24px] text-[16px] font-[600]"
    >
      {t(
        'billing_not_charged_today',
        'You will not be charged today. Cancel any time in Settings before day 7 and you pay nothing.'
      )}
    </div>
  );
};

/** The trial's limits, all of them, folded so the plans come first. */
export const TrialLimitsDetails: FC = () => {
  const t = useT();
  return (
    <details className="mb-[10px] text-[14px]">
      <summary className="cursor-pointer underline underline-offset-4">
        {t('billing_trial_included', 'What is included in the trial?')}
      </summary>
      <div className="mt-[8px]">
        <TrialLimitsNote />
      </div>
    </details>
  );
};
