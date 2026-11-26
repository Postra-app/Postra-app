'use client';

import { FC, useCallback } from 'react';
import type { Dayjs } from 'dayjs';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

type Counter = { used: number; limit: number };
export type TrialStatus = {
  trial: true;
  endsAt: number;
  hasCard: boolean;
  // Cancelled from Billing: the plan ends with the trial, card or not.
  cancelled?: boolean;
  channels: Counter;
  posts: Counter;
  images: Counter;
};

const DAY = 86_400_000;

// On every page during the free trial: days left, how much of the
// trial is used, and how to keep the plan. GET /billing/trial.
export const TrialBarView: FC<{
  status: TrialStatus;
  now: number;
  canAddCard: boolean;
  onAddCard: () => void;
  billingHref?: string;
}> = ({ status, now, canAddCard, onAddCard, billingHref = '/billing' }) => {
  const t = useT();
  const days = Math.ceil((status.endsAt - now) / DAY);
  return (
    <div
      data-testid="trial-bar"
      className="flex flex-wrap items-center gap-x-[18px] gap-y-[6px] px-[16px] py-[8px] mb-[8px] rounded-[12px] bg-[#618DFF]/15 border border-[#618DFF]/40 text-[14px]"
    >
      <span className="font-[700]">
        {days > 1
          ? t('trial_bar_days_left', 'Free trial: {{days}} days left', { days })
          : t('trial_bar_ends_today', 'Free trial: ends today')}
      </span>
      <span>
        {t('trial_bar_channels', 'Channels {{used}} / {{limit}}', status.channels)}
      </span>
      <span>
        {t('trial_bar_posts', 'Posts {{used}} / {{limit}}', status.posts)}
      </span>
      <span>
        {t('trial_bar_images', 'AI images {{used}} / {{limit}}', status.images)}
      </span>
      <span className="flex-1" />
      {status.cancelled ? (
        <>
          <span>
            {t(
              'trial_bar_cancelled',
              'Your plan is cancelled and ends with the trial.'
            )}
          </span>
          {canAddCard && (
            <a
              href={billingHref}
              className="h-[32px] px-[12px] rounded-[8px] bg-[#618DFF] text-white font-[600] inline-flex items-center"
            >
              {t('trial_bar_reactivate', 'Reactivate in Billing')}
            </a>
          )}
        </>
      ) : status.hasCard ? (
        <span>
          {t(
            'trial_bar_card_added',
            'Card added: your plan starts when the trial ends.'
          )}
        </span>
      ) : canAddCard ? (
        <button
          type="button"
          onClick={onAddCard}
          className="h-[32px] px-[12px] rounded-[8px] bg-[#618DFF] text-white font-[600]"
        >
          {t('trial_bar_add_card', 'Add a card to keep your plan')}
        </button>
      ) : null}
    </div>
  );
};

export const TrialBar: FC = () => {
  const user = useUser();
  const fetch = useFetch();
  // Counted again when the customer comes back to the tab and once a minute,
  // so an image made or a post scheduled shows without a reload.
  const { data } = useSWR<TrialStatus | { trial: false }>(
    user?.isTrailing ? '/billing/trial' : null,
    async () => (await fetch('/billing/trial')).json(),
    { revalidateOnFocus: true, refreshInterval: 60_000 }
  );
  // Stripe's own page for adding a card: the card becomes the one the first
  // payment after the trial is taken from.
  const addCard = useCallback(async () => {
    const { portal } = await (await fetch('/billing/portal?flow=card')).json();
    if (portal) {
      window.location.href = portal;
    }
  }, []);
  if (!data || !data.trial) {
    return null;
  }
  return (
    <TrialBarView
      status={data}
      now={Date.now()}
      canAddCard={user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'}
      onAddCard={addCard}
    />
  );
};

// Whether a post on this date would come due after a trial that ends without
// a plan: one that has no card, or one cancelled from Billing. Such a post is
// not sent.
export const afterCardlessTrial = (
  status: TrialStatus | { trial: false } | undefined,
  date: number
) =>
  !!status &&
  status.trial &&
  (!status.hasCard || !!status.cancelled) &&
  date > status.endsAt;

export const TrialDateWarningView: FC<{
  show: boolean;
  cancelled?: boolean;
  hasCard?: boolean;
}> = ({ show, cancelled, hasCard }) => {
  const t = useT();
  if (!show) {
    return null;
  }
  if (cancelled) {
    return (
      <div
        data-testid="trial-date-warning"
        role="note"
        className="text-[13px] text-amber-400 max-w-[260px] leading-[1.3]"
      >
        {hasCard
          ? t(
              'trial_date_after_end_cancelled',
              'This date is after your free trial ends, and your plan is cancelled. Reactivate it in Billing, or the post will not be sent.'
            )
          : t(
              'trial_date_after_end_cancelled_no_card',
              'This date is after your free trial ends, and your plan is cancelled. Reactivate it in Billing and add a card, or the post will not be sent.'
            )}
      </div>
    );
  }
  return (
    <div
      data-testid="trial-date-warning"
      role="note"
      className="text-[13px] text-amber-400 max-w-[260px] leading-[1.3]"
    >
      {t(
        'trial_date_after_end',
        'This date is after your free trial ends. Add a card to keep your plan, or the post will not be sent.'
      )}
    </div>
  );
};

/** Next to the composer's date: warns when it is after a trial without a card. */
export const TrialDateWarning: FC<{ date: Dayjs }> = ({ date }) => {
  const user = useUser();
  const fetch = useFetch();
  const { data } = useSWR<TrialStatus | { trial: false }>(
    user?.isTrailing ? '/billing/trial' : null,
    async () => (await fetch('/billing/trial')).json(),
    { revalidateOnFocus: false }
  );
  return (
    <TrialDateWarningView
      show={afterCardlessTrial(data, date.valueOf())}
      cancelled={!!data && data.trial && !!data.cancelled}
      hasCard={!!data && data.trial && data.hasCard}
    />
  );
};
