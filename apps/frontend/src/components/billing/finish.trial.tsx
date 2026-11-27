import React, { FC, useCallback, useEffect, useState } from 'react';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { useSWRConfig } from 'swr';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { planLabel } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { BILLING_CREDITS_KEYS } from '@gitroom/frontend/components/billing/ai.usage.this.month';

type Step = 'confirm' | 'working' | 'done' | 'already' | 'problem' | 'no-card';

// Ending the trial charges the card. It used to happen the moment this page
// opened with ?finishTrial=true — no price, no question, and again on every
// reload. Now the customer sees what
// they will pay and confirms; the parameter leaves the address bar at once.
export const FinishTrial: FC<{ close: () => void }> = (props) => {
  const [step, setStep] = useState<Step>('confirm');
  const [problem, setProblem] = useState<{ url?: string }>({});
  const [plan, setPlan] = useState<{
    amount: number;
    currency: string;
    tier: string | null;
    period: string | null;
  } | null>(null);
  const fetch = useFetch();
  const t = useT();
  const { mutate } = useSWRConfig();

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('finishTrial')) {
      url.searchParams.delete('finishTrial');
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    (async () => {
      try {
        // What Stripe will charge for this subscription now, not today's
        // price list (an older price or a discount differ).
        const preview = await (
          await fetch('/billing/finish-trial/preview')
        ).json();
        if (preview && Number.isFinite(preview.amount)) {
          setPlan(preview);
        }
        // A trial started without a card: ending it now needs one first,
        // or Stripe would cancel it instead of charging.
        if (preview && preview.hasCard === false) {
          setStep('no-card');
        }
      } catch {
        // The question still works without the price line.
      }
    })();
  }, []);

  const yearly = plan?.period === 'YEARLY';
  const amount = plan
    ? `${plan.currency === 'gbp' ? '£' : `${plan.currency.toUpperCase()} `}${
        plan.amount % 100 === 0
          ? plan.amount / 100
          : (plan.amount / 100).toFixed(2)
      }`
    : '';

  const checkFinished = useCallback(async (attempt = 0) => {
    let finished = false;
    try {
      finished = (await (await fetch('/billing/is-trial-finished')).json())
        ?.finished;
    } catch {
      finished = false;
    }
    if (finished) {
      setStep('done');
      // The open app still held the trial's limits: the AI counts on this
      // page read "10 of 75 images left" after paying, until a reload.
      mutate('/user/self');
      mutate('/billing/invoices');
      BILLING_CREDITS_KEYS.forEach((key) => mutate(key));
      return;
    }
    if (attempt >= 30) {
      setStep('problem');
      return;
    }
    await timer(2000);
    return checkFinished(attempt + 1);
  }, []);

  const finishSubscription = useCallback(async () => {
    setStep('working');
    // A failed request left the dialog spinning for good.
    let result: { finish?: boolean; url?: string; reason?: string } | undefined;
    try {
      result = await (
        await fetch('/billing/finish-trial', {
          method: 'POST',
        })
      ).json();
    } catch {
      setStep('problem');
      return;
    }
    if (result?.reason === 'no-card') {
      setStep('no-card');
      return;
    }
    // Paid already: a second visit used to read as a failed payment.
    if (result?.reason === 'no-trial') {
      setStep('already');
      mutate('/user/self');
      return;
    }
    // finish:false otherwise means Stripe did not take the payment (usually
    // 3-D Secure), so the plan will not flip and polling would spin forever.
    if (!result?.finish) {
      setProblem({ url: result?.url });
      setStep('problem');
      return;
    }
    checkFinished();
  }, []);

  // Stripe's page for adding a card, then back here to confirm the payment.
  const addCard = useCallback(async () => {
    try {
      const { portal } = await (
        await fetch('/billing/portal?flow=card-now')
      ).json();
      if (portal) {
        window.location.href = portal;
        return;
      }
    } catch {
      // Falls through to the problem step.
    }
    setStep('problem');
  }, []);

  // Escape closes it like every other window, except while the payment runs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step !== 'working') props.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, props.close]);

  // On a phone the 500 px box inside 60 px of padding ran off both edges: no
  // close button, and the sentence with the amount cut off.
  return (
    <div className="text-textColor fixed start-0 top-0 bg-primary/80 z-[300] w-full h-full p-[60px] phone:p-[16px] overflow-y-auto animate-fade justify-center flex bg-black/50">
      <div className="max-w-full">
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('finishing_trial', 'Finishing your trial')}
          className="flex gap-[10px] flex-col w-[500px] max-w-full h-auto bg-[rgba(15,23,42,0.92)] border-white/10 border-2 rounded-[16px] pb-[20px] px-[20px] relative"
        >
          <div className="flex">
            <div className="flex-1">
              <TopTitle title={t('finishing_trial', 'Finishing your trial')} />
            </div>
            <button
              onClick={props.close}
              aria-label={t('close_dialog', 'Close')}
              className="outline-none absolute end-[10px] top-[10px] mantine-UnstyledButton-root mantine-ActionIcon-root bg-primary hover:bg-tableBorder cursor-pointer mantine-Modal-close mantine-1dcetaa"
              type="button"
            >
              <svg
                viewBox="0 0 15 15"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
              >
                <path
                  d="M11.7816 4.03157C12.0062 3.80702 12.0062 3.44295 11.7816 3.2184C11.5571 2.99385 11.193 2.99385 10.9685 3.2184L7.50005 6.68682L4.03164 3.2184C3.80708 2.99385 3.44301 2.99385 3.21846 3.2184C2.99391 3.44295 2.99391 3.80702 3.21846 4.03157L6.68688 7.49999L3.21846 10.9684C2.99391 11.193 2.99391 11.557 3.21846 11.7816C3.44301 12.0061 3.80708 12.0061 4.03164 11.7816L7.50005 8.31316L10.9685 11.7816C11.193 12.0061 11.5571 12.0061 11.7816 11.7816C12.0062 11.557 12.0062 11.193 11.7816 10.9684L8.31322 7.49999L11.7816 4.03157Z"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                ></path>
              </svg>
            </button>
          </div>
          <div className="relative h-[400px]">
            <div className="absolute left-0 top-0 w-full h-full overflow-hidden overflow-y-auto">
              <div className="mt-[10px] flex w-full justify-center items-center gap-[10px]">
                {step === 'confirm' && (
                  <div className="flex flex-col">
                    <div>
                      {amount
                        ? t(
                            'finish_trial_confirm',
                            'End your trial now and pay {{amount}} for {{plan}} ({{period}})?',
                            {
                              amount,
                              plan: planLabel(plan?.tier),
                              period: yearly
                                ? t('yearly_lower', 'yearly')
                                : t('monthly_lower', 'monthly'),
                            }
                          )
                        : t(
                            'finish_trial_confirm_plain',
                            'End your trial now and pay for your plan?'
                          )}
                    </div>
                    <div className="text-[14px] opacity-80 mt-[8px]">
                      {t(
                        'finish_trial_confirm_note',
                        'Your card is charged straight away and your plan renews from today.'
                      )}
                    </div>
                    <div className="flex gap-[10px] mt-[20px] phone:flex-col">
                      <Button className="flex-1" onClick={finishSubscription}>
                        {amount
                          ? t(
                              'finish_trial_pay',
                              'End trial and pay {{amount}} now',
                              {
                                amount,
                              }
                            )
                          : t(
                              'finish_trial_pay_plain',
                              'End trial and pay now'
                            )}
                      </Button>
                      <Button className="flex-1" onClick={() => props.close()}>
                        {t('keep_my_trial', 'Keep my trial')}
                      </Button>
                    </div>
                  </div>
                )}
                {step === 'no-card' && (
                  <div className="flex flex-col">
                    <div>
                      {t(
                        'finish_trial_add_card',
                        'To end the trial now and start your plan, add a card first. You come back here to confirm the payment.'
                      )}
                    </div>
                    <div className="flex gap-[10px] mt-[20px] phone:flex-col">
                      <Button className="flex-1" onClick={addCard}>
                        {t('add_a_card', 'Add a card')}
                      </Button>
                      <Button className="flex-1" onClick={() => props.close()}>
                        {t('keep_my_trial', 'Keep my trial')}
                      </Button>
                    </div>
                  </div>
                )}
                {step === 'working' && (
                  <LoadingComponent height={150} width={150} />
                )}
                {step === 'already' && (
                  <div className="flex flex-col">
                    <div>
                      {t(
                        'trial_already_ended',
                        'Your trial has already ended - your plan is active.'
                      )}
                    </div>
                    <div className="flex gap-[10px] mt-[20px] phone:flex-col">
                      <Button className="flex-1" onClick={() => props.close()}>
                        {t('close_dialog', 'Close')}
                      </Button>
                    </div>
                  </div>
                )}
                {step === 'problem' && (
                  <div className="flex flex-col">
                    <div>
                      {t(
                        'trial_finish_payment_pending',
                        'We could not take the first payment yet. Your bank may need you to confirm it.'
                      )}
                    </div>
                    <div className="flex gap-[10px] mt-[20px] phone:flex-col">
                      <Button
                        className="flex-1"
                        onClick={() =>
                          window.open(problem.url || '/billing', '_blank')
                        }
                      >
                        {problem.url
                          ? t('confirm_payment', 'Confirm payment')
                          : t('open_billing', 'Open billing')}
                      </Button>
                      <Button className="flex-1" onClick={() => props.close()}>
                        {t('close_dialog', 'Close')}
                      </Button>
                    </div>
                  </div>
                )}
                {step === 'done' && (
                  <div className="flex flex-col">
                    <div>
                      {t(
                        'trial_finished_charged',
                        'Your trial has ended and the payment has been charged.'
                      )}
                    </div>
                    <div className="flex gap-[10px] mt-[20px] phone:flex-col">
                      {/* One way out: "Close window" called window.close(),
                          which a browser ignores for a tab it did not open
                          from a script. */}
                      <Button className="flex-1" onClick={() => props.close()}>
                        {t('close_dialog', 'Close')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
