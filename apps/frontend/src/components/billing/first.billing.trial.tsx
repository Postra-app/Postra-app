'use client';

import { FC } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  TRIAL_AGENT_MESSAGES,
  TRIAL_AI_IMAGES,
  TRIAL_CHANNEL_CAP,
  TRIAL_DAYS,
  TRIAL_LIMITS,
  TRIAL_VIDEO_CLIPS,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// What a new account is told about the free trial on the plan screen. The
// trial starts without a card, and its smaller limits
// are said in full before it starts. Every number comes from pricing.ts.

/** Under the plans: the trial is free and needs no card; the plan's price. */
export const TrialPriceLine: FC<{
  price: number;
  period: 'MONTHLY' | 'YEARLY';
  plan: string;
}> = ({ price, period, plan }) => {
  const t = useT();
  return (
    <div
      data-testid="trial-price-line"
      className="mt-[16px] text-[16px] font-[600]"
    >
      {period === 'MONTHLY'
        ? t(
            'billing_free_trial_price_month',
            '{{days}} days free, no card needed. After the trial, {{plan}} is £{{price}} / month.',
            { price, plan, days: TRIAL_DAYS }
          )
        : t(
            'billing_free_trial_price_year',
            '{{days}} days free, no card needed. After the trial, {{plan}} is £{{price}} / year.',
            { price, plan, days: TRIAL_DAYS }
          )}
    </div>
  );
};

/** Starts the trial on the chosen plan: one click, no card form. */
export const StartTrialButton: FC<{ onStart: () => void; loading: boolean }> = ({
  onStart,
  loading,
}) => {
  const t = useT();
  return (
    <button
      type="button"
      disabled={loading}
      className="flex mt-[16px] h-[52px] w-full items-center justify-center rounded-[12px] bg-[#618DFF] text-[16px] font-[700] text-white disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
      onClick={onStart}
    >
      {t('billing_start_free_trial', 'Start {{days}}-day free trial', {
        days: TRIAL_DAYS,
      })}
    </button>
  );
};

/**
 * The trial's limits, open and in numbers, before the trial starts: a trial
 * has smaller limits than the plan, and the customer is told plainly.
 */
export const TrialLimitsBox: FC = () => {
  const t = useT();
  const limits = [
    t('billing_trial_box_channels', '{{n}} channels', { n: TRIAL_CHANNEL_CAP }),
    t('billing_trial_box_posts', '{{n}} posts', {
      n: TRIAL_LIMITS.posts_per_month,
    }),
    t('billing_trial_box_images', '{{n}} AI images', { n: TRIAL_AI_IMAGES }),
    t('billing_trial_box_videos', '{{n}} AI video', { n: TRIAL_VIDEO_CLIPS }),
    t('billing_trial_box_questions', '{{n}} questions to the AI assistant', {
      n: TRIAL_AGENT_MESSAGES,
    }),
  ];
  return (
    <section
      data-testid="trial-limits"
      className="mt-[24px] mb-[10px] p-[20px] rounded-[16px] border-[1.5px] border-[#618DFF]/60 text-[15px]"
    >
      <h3 className="font-[700] mb-[8px]">
        {t('billing_trial_box_title', 'Your {{days}}-day free trial includes:', {
          days: TRIAL_DAYS,
        })}
      </h3>
      <ul className="flex flex-wrap gap-x-[18px] gap-y-[4px] list-disc ps-[18px]">
        {limits.map((limit) => (
          <li key={limit}>{limit}</li>
        ))}
      </ul>
      <p className="mt-[10px] text-newTextColor/70">
        {t(
          'billing_trial_box_full',
          "Your plan's full limits start with your first payment."
        )}
      </p>
    </section>
  );
};

/** In place of the headline once a trial without a card has ended. */
export const TrialEndedHeadline: FC = () => {
  const t = useT();
  return (
    <div data-testid="trial-ended">
      <h2 className="text-[46px] font-[600] leading-[110%] tablet:text-[36px] mobile:!text-[30px] text-balance">
        {t('billing_trial_ended_title', 'Your free trial has ended')}
      </h2>
      <p className="mt-[16px] text-[18px]">
        {t(
          'billing_trial_ended_text',
          'Your channels, posts and media are saved. Choose a plan and add a card to carry on - publishing starts again straight away.'
        )}
      </p>
    </div>
  );
};
