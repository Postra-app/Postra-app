'use client';

import { Slider } from '@gitroom/react/form/slider';
import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Subscription } from '@prisma/client';
import { useDebouncedCallback } from 'use-debounce';
import ReactLoading from '@gitroom/frontend/components/layout/loading';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useToaster } from '@gitroom/react/toaster/toaster';
import dayjs from 'dayjs';
import {
  pricing,
  planLabel,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { FAQComponent } from '@gitroom/frontend/components/billing/faq.component';
import useSWR, { useSWRConfig } from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { useRouter, useSearchParams } from 'next/navigation';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import {
  areYouSure,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';
import { Textarea } from '@gitroom/react/form/textarea';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useUtmUrl } from '@gitroom/helpers/utils/utm.saver';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { FinishTrial } from '@gitroom/frontend/components/billing/finish.trial';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useDubClickId } from '@gitroom/frontend/components/layout/dubAnalytics';
import { LogoutComponent } from '@gitroom/frontend/components/layout/logout.component';
import { TrialLimitsNote } from '@gitroom/frontend/components/billing/trial.limits.note';
import { AiUsageThisMonth } from '@gitroom/frontend/components/billing/ai.usage.this.month';
import { BillingHistory } from '@gitroom/frontend/components/billing/billing.history.component';
import { planFeatures } from '@gitroom/frontend/components/billing/plan.features';

export const Prorate: FC<{
  period: 'MONTHLY' | 'YEARLY';
  pack: 'STANDARD' | 'PRO';
}> = (props) => {
  const { period, pack } = props;
  const t = useT();
  const fetch = useFetch();
  const [price, setPrice] = useState<number | false>(0);
  const [loading, setLoading] = useState(false);
  // Only the answer for the last choice is shown: a monthly quote landing
  // after the yearly one used to replace it next to the yearly offer
  // (FE-B-4).
  const latest = useRef(0);
  const calculatePrice = useDebouncedCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    const { price: quoted } = await (
      await fetch('/billing/prorate', {
        method: 'POST',
        body: JSON.stringify({
          period,
          billing: pack,
        }),
      })
    ).json();
    if (request !== latest.current) return;
    setPrice(quoted);
    setLoading(false);
  }, 500);
  useEffect(() => {
    setPrice(false);
    calculatePrice();
  }, [period, pack]);
  if (loading) {
    return (
      <div className="pt-[12px]">
        <ReactLoading type="spin" color="#fff" width={20} height={20} />
      </div>
    );
  }
  if (price === false) {
    return null;
  }
  return (
    <div className="text-[12px] flex pt-[12px]">
      ({t('pay_today', 'Pay Today')} £{(price < 0 ? 0 : price)?.toFixed(2)})
    </div>
  );
};
export const Features: FC<{
  pack: 'FREE' | 'STANDARD' | 'PRO';
}> = (props) => {
  const { pack } = props;
  const t = useT();
  const features = useMemo(
    () => planFeatures(pack).map((f) => t(f.key, f.text, f.vars)),
    [pack, t]
  );
  return (
    <div className="flex flex-col gap-[10px] justify-center text-[16px] text-newTextColor/55">
      {features.map((feature) => (
        <div key={feature} className="flex gap-[20px]">
          <div>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
            >
              <path
                d="M16.2806 9.21937C16.3504 9.28903 16.4057 9.37175 16.4434 9.46279C16.4812 9.55384 16.5006 9.65144 16.5006 9.75C16.5006 9.84856 16.4812 9.94616 16.4434 10.0372C16.4057 10.1283 16.3504 10.211 16.2806 10.2806L11.0306 15.5306C10.961 15.6004 10.8783 15.6557 10.7872 15.6934C10.6962 15.7312 10.5986 15.7506 10.5 15.7506C10.4014 15.7506 10.3038 15.7312 10.2128 15.6934C10.1218 15.6557 10.039 15.6004 9.96938 15.5306L7.71938 13.2806C7.57865 13.1399 7.49959 12.949 7.49959 12.75C7.49959 12.551 7.57865 12.3601 7.71938 12.2194C7.86011 12.0786 8.05098 11.9996 8.25 11.9996C8.44903 11.9996 8.6399 12.0786 8.78063 12.2194L10.5 13.9397L15.2194 9.21937C15.289 9.14964 15.3718 9.09432 15.4628 9.05658C15.5538 9.01884 15.6514 8.99941 15.75 8.99941C15.8486 8.99941 15.9462 9.01884 16.0372 9.05658C16.1283 9.09432 16.211 9.14964 16.2806 9.21937ZM21.75 12C21.75 13.9284 21.1782 15.8134 20.1068 17.4168C19.0355 19.0202 17.5127 20.2699 15.7312 21.0078C13.9496 21.7458 11.9892 21.9389 10.0979 21.5627C8.20656 21.1865 6.46928 20.2579 5.10571 18.8943C3.74215 17.5307 2.81355 15.7934 2.43735 13.9021C2.06114 12.0108 2.25422 10.0504 2.99218 8.26884C3.73013 6.48726 4.97982 4.96451 6.58319 3.89317C8.18657 2.82183 10.0716 2.25 12 2.25C14.585 2.25273 17.0634 3.28084 18.8913 5.10872C20.7192 6.93661 21.7473 9.41498 21.75 12ZM20.25 12C20.25 10.3683 19.7661 8.77325 18.8596 7.41655C17.9531 6.05984 16.6646 5.00242 15.1571 4.37799C13.6497 3.75357 11.9909 3.59019 10.3905 3.90852C8.79017 4.22685 7.32016 5.01259 6.16637 6.16637C5.01259 7.32015 4.22685 8.79016 3.90853 10.3905C3.5902 11.9908 3.75358 13.6496 4.378 15.1571C5.00242 16.6646 6.05984 17.9531 7.41655 18.8596C8.77326 19.7661 10.3683 20.25 12 20.25C14.1873 20.2475 16.2843 19.3775 17.8309 17.8309C19.3775 16.2843 20.2475 14.1873 20.25 12Z"
                fill="#06ff00"
              />
            </svg>
          </div>
          <div>{feature}</div>
        </div>
      ))}
    </div>
  );
};

const Accept: FC<{ resolve: (res: boolean) => void }> = ({ resolve }) => {
  const [loading, setLoading] = useState(false);
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();

  const apply = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/billing/apply-discount', {
        method: 'POST',
      });
      if (!response.ok) {
        console.error(
          '[Postra:billing] apply-discount failed',
          response.status
        );
        toaster.show(
          t(
            'discount_failed',
            'Could not apply the discount, please try again.'
          ),
          'warning'
        );
        return;
      }
      resolve(true);
      toaster.show(t('discount_applied', '50% discount applied'));
    } catch (e) {
      console.error('[Postra:billing] apply-discount failed', e);
      toaster.show(
        t('discount_failed', 'Could not apply the discount, please try again.'),
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div>
      <div className="mb-[20px]">
        {t(
          'accept_discount_q',
          'How about 50% off for 3 months instead? 🙏🏻'
        )}
      </div>
      <div className="flex gap-[10px]">
        <Button loading={loading} onClick={apply}>
          {t('apply_discount', 'Apply 50% off for 3 months')}
        </Button>
        <Button variant="danger" onClick={() => resolve(false)}>
          {t('cancel_my_subscription', 'Cancel my subscription')}
        </Button>
      </div>
    </div>
  );
};
const Info: FC<{
  proceed: (feedback: string) => void;
}> = (props) => {
  const [feedback, setFeedback] = useState('');
  const modal = useModals();
  const events = useFireEvents();
  const cancel = useCallback(() => {
    props.proceed(feedback);
    events('cancel_subscription');
    modal.closeAll();
  }, [modal, feedback]);

  const t = useT();

  return (
    <div className="relative flex gap-[20px] flex-col flex-1 rounded-[12px]">
      <div>
        {t(
          'would_you_mind_shortly_tell_us_what_we_could_have_done_better',
          'Would you mind shortly tell us what we could have done better?'
        )}
      </div>
      <div>
        <Textarea
          className="bg-white/[0.03]"
          label={t('feedback', 'Feedback')}
          name="feedback"
          disableForm={true}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
      <div>
        <Button disabled={feedback.length < 20} onClick={cancel}>
          {feedback.length < 20
            ? t('please_add_at_least', 'Please add at least 20 characters')
            : t('cancel_subscription', 'Cancel Subscription')}
        </Button>
      </div>
    </div>
  );
};
export const MainBillingComponent: FC<{
  sub?: Subscription;
}> = (props) => {
  const { sub } = props;
  const { isGeneral } = useVariables();
  const { mutate } = useSWRConfig();
  const fetch = useFetch();
  const toast = useToaster();
  const user = useUser();
  const dub = useDubClickId();
  const modal = useModals();
  const router = useRouter();
  const utm = useUtmUrl();
  const track = useTrack();
  const t = useT();
  const queryParams = useSearchParams();
  const [finishTrial, setFinishTrial] = useState(
    !!queryParams.get('finishTrial')
  );

  const [subscription, setSubscription] = useState<Subscription | undefined>(
    sub
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [period, setPeriod] = useState<'MONTHLY' | 'YEARLY'>(
    subscription?.period || 'MONTHLY'
  );
  const [monthlyOrYearly, setMonthlyOrYearly] = useState<'on' | 'off'>(
    period === 'MONTHLY' ? 'off' : 'on'
  );

  // A lower plan waiting for the next billing period (E2E-07-44).
  const loadPending = useCallback(
    async () => (await fetch('/billing/pending-change')).json(),
    [fetch]
  );
  const { data: pending, mutate: refreshPending } = useSWR<{
    billing?: string;
    on?: string;
  }>(subscription?.id ? 'billing-pending-change' : null, loadPending);
  const confirmPlanChange = useCallback(
    async (billing: string, current: string) => {
      const period = monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY';
      let quote: {
        price?: number;
        renewsOn?: string | null;
        renewalPrice?: number;
        scheduled?: boolean;
      } = {};
      try {
        const response = await fetch('/billing/prorate', {
          method: 'POST',
          body: JSON.stringify({ period, billing }),
        });
        quote = response.ok ? await response.json() : {};
      } catch {
        quote = {};
      }
      // Without Stripe's quote the window would offer a free change that may
      // charge the card: stop, and say so (Codex on the 10-09 branch).
      if (typeof quote.price !== 'number' || !quote.renewsOn) {
        toast.show(
          t('billing_action_failed', 'Something went wrong, please try again.'),
          'warning'
        );
        return false;
      }
      const today = `£${Math.max(quote.price || 0, 0).toFixed(2)}`;
      const plan = planLabel(billing);
      const renewal =
        quote.renewsOn && quote.renewalPrice
          ? t(
              period === 'YEARLY' ? 'plan_change_renewal_year' : 'plan_change_renewal_month',
              period === 'YEARLY'
                ? 'From {{date}}: £{{price}} a year.'
                : 'From {{date}}: £{{price}} a month.',
              {
                date: dayjs(quote.renewsOn).format('D MMMM'),
                price: quote.renewalPrice,
              }
            )
          : '';
      const upgrade = (quote.price || 0) > 0;
      // A lower plan on a paid plan waits for the renewal; the server says
      // which, by the same rule as the change itself.
      const on = dayjs(quote.renewsOn).format('D MMMM');
      if (quote.scheduled) {
        return areYouSure({
          title: t('plan_change_title', 'Change your plan'),
          description: `${t(
            'plan_change_scheduled',
            'Change to {{plan}} on {{date}}? You keep {{current}} until then.',
            { plan, date: on, current: planLabel(current) }
          )} ${renewal}`.trim(),
          approveLabel: t('plan_change_scheduled_confirm', 'Change on {{date}}', {
            date: on,
          }),
          cancelLabel: t('cancel', 'Cancel'),
        });
      }
      return areYouSure({
        title: t('plan_change_title', 'Change your plan'),
        description: upgrade
          ? `${t(
              'plan_change_upgrade',
              'Upgrade to {{plan}} now? Today: {{amount}} for the rest of this billing month (what is left of {{current}} is taken off).',
              { plan, amount: today, current: planLabel(current) }
            )} ${renewal}`.trim()
          : `${t(
              'plan_change_down',
              'Change to {{plan}} now? Nothing to pay today.',
              { plan }
            )} ${renewal}`.trim(),
        approveLabel: upgrade
          ? t('plan_change_pay', 'Upgrade and pay {{amount}}', { amount: today })
          : t('plan_change_confirm', 'Change plan'),
        cancelLabel: t('cancel', 'Cancel'),
      });
    },
    [monthlyOrYearly, t, toast]
  );
  const [initialChannels, setInitialChannels] = useState(
    sub?.totalChannels || 1
  );
  useEffect(() => {
    if (initialChannels !== sub?.totalChannels) {
      setInitialChannels(sub?.totalChannels || 1);
    }
    if (period !== sub?.period) {
      setPeriod(sub?.period || 'MONTHLY');
      setMonthlyOrYearly(
        (sub?.period || 'MONTHLY') === 'MONTHLY' ? 'off' : 'on'
      );
    }
    setSubscription(sub);
  }, [sub]);
  const updatePayment = useCallback(async () => {
    try {
      const response = await fetch('/billing/portal');
      const portal = response.ok ? (await response.json())?.portal : undefined;
      if (!portal) {
        throw new Error(`no portal url (status ${response.status})`);
      }
      window.location.href = portal;
    } catch (e) {
      console.error('[Postra:billing] portal failed', e);
      toast.show(
        t(
          'billing_portal_failed',
          'Could not open the billing portal, please try again.'
        ),
        'warning'
      );
    }
  }, []);
  const currentPackage = useMemo(() => {
    if (!subscription) {
      return 'FREE';
    }
    if (period === 'YEARLY' && monthlyOrYearly === 'off') {
      return '';
    }
    if (period === 'MONTHLY' && monthlyOrYearly === 'on') {
      return '';
    }
    return subscription?.subscriptionTier;
  }, [subscription, initialChannels, monthlyOrYearly, period]);
  const reactivating = useRef(false);
  const moveToCheckout = useCallback(
    (billing: 'STANDARD' | 'PRO' | 'FREE', reactivate = false) =>
      async () => {
        try {
          if (reactivate) {
            // /billing/cancel toggles: a second press (Enter while the first
            // request runs) cancelled the subscription again under a
            // "reactivated" message (E2E-07-16).
            if (reactivating.current) return;
            reactivating.current = true;
            setLoading(true);
            const reactivateResponse = await fetch('/billing/cancel', {
              method: 'POST',
              body: JSON.stringify({
                feedback: '',
              }),
              headers: {
                'Content-Type': 'application/json',
              },
            });
            if (!reactivateResponse.ok) {
              console.error(
                '[Postra:billing] reactivate failed',
                reactivateResponse.status
              );
              toast.show(
                t(
                  'billing_action_failed',
                  'Something went wrong, please try again.'
                ),
                'warning'
              );
              reactivating.current = false;
              setLoading(false);
              return;
            }
            const { cancel_at } = await reactivateResponse.json();
            setSubscription((subs) => ({
              ...subs!,
              cancelAt: cancel_at,
            }));

            toast.show(
              t(
                'subscription_reactivated',
                'Subscription reactivated successfully'
              )
            );
            reactivating.current = false;
            setLoading(false);
            return;
          }

          const messages = [];
          if (
            pricing[billing].team_members <
            (pricing[subscription?.subscriptionTier!]?.team_members ?? 0)
          ) {
            messages.push(
              `Some team members may be removed to fit your new plan`
            );
          }
          if (billing === 'FREE') {
            if (
              subscription?.cancelAt ||
              (await deleteDialog(
                `Are you sure you want to cancel your subscription?
              ${messages.join(', ')}`,
                'Yes, cancel',
                'Cancel Subscription'
              ))
            ) {
              const discountResponse = await fetch('/billing/check-discount');
              // the retention offer is optional — a failure must not block cancelling
              const checkDiscount = discountResponse.ok
                ? await discountResponse.json()
                : {};
              if (checkDiscount.offerCoupon) {
                const info = await new Promise((res) => {
                  modal.openModal({
                    title: 'Before you cancel',
                    withCloseButton: true,
                    classNames: {
                      modal: 'bg-transparent text-textColor',
                    },
                    children: <Accept resolve={res} />,
                  });
                });

                modal.closeAll();

                if (info) {
                  return;
                }
              }

              const info = await new Promise((res) => {
                modal.openModal({
                  title: t(
                    'we_are_sorry_to_see_you_go',
                    'We are sorry to see you go :('
                  ),
                  withCloseButton: true,
                  classNames: {
                    modal: 'bg-transparent text-textColor',
                  },
                  children: <Info proceed={(e) => res(e)} />,
                });
              });

              setLoading(true);
              const cancelResponse = await fetch('/billing/cancel', {
                method: 'POST',
                body: JSON.stringify({
                  feedback: info,
                }),
                headers: {
                  'Content-Type': 'application/json',
                },
              });
              if (!cancelResponse.ok) {
                console.error(
                  '[Postra:billing] cancel failed',
                  cancelResponse.status
                );
                toast.show(
                  t(
                    'billing_action_failed',
                    'Something went wrong, please try again.'
                  ),
                  'warning'
                );
                return;
              }
              const { cancel_at } = await cancelResponse.json();
              setSubscription((subs) => ({
                ...subs!,
                cancelAt: cancel_at,
              }));
              if (cancel_at)
                toast.show(
                  t(
                    'subscription_canceled',
                    'Subscription set to canceled successfully'
                  )
                );
              setLoading(false);
            }
            return;
          }
          if (
            messages.length &&
            !(await deleteDialog(messages.join(', '), 'Yes, continue'))
          ) {
            return;
          }
          // A paying account's change charges the card at once: ask first,
          // with a fresh quote — the "Pay today" next to the button is from
          // when the page loaded (E2E-07-43: £50.00 shown, £49.68 charged).
          if (
            subscription?.subscriptionTier &&
            !subscription?.isLifetime &&
            !(await confirmPlanChange(billing, subscription.subscriptionTier))
          ) {
            return;
          }
          setLoading(true);
          const subscribeResponse = await fetch('/billing/subscribe', {
            method: 'POST',
            body: JSON.stringify({
              period: monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY',
              utm,
              billing,
              ...(dub ? { dub } : {}),
            }),
          });
          if (!subscribeResponse.ok) {
            console.error(
              '[Postra:billing] subscribe failed',
              subscribeResponse.status
            );
            toast.show(
              t(
                'billing_action_failed',
                'Something went wrong, please try again.'
              ),
              'warning'
            );
            return;
          }
          const { url, portal, scheduled } = await subscribeResponse.json();
          if (scheduled) {
            // Nothing changes until the renewal; the note under the current
            // plan says when.
            await refreshPending();
            return;
          }
          if (url) {
            await track(TrackEnum.InitiateCheckout, {
              value:
                pricing[billing][
                  monthlyOrYearly === 'on' ? 'year_price' : 'month_price'
                ],
            });
            window.location.href = url;
            return;
          }
          if (portal) {
            if (
              await deleteDialog(
                'We could not charge your credit card, please update your payment method',
                'Update',
                'Payment Method Required'
              )
            ) {
              window.open(portal);
            }
          } else {
            setPeriod(monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY');
            setSubscription((subs) => ({
              ...subs!,
              subscriptionTier: billing,
              cancelAt: null,
            }));
            // Ask the server: the new plan brings its own limits (channels,
            // seats), which a local `tier` swap left at the old values
            // (E2E-07-19).
            mutate(
              '/user/self',
              {
                ...user,
                tier: billing,
              },
              {
                revalidate: true,
              }
            );
            toast.show(
              t('subscription_updated', 'Subscription updated successfully')
            );
          }
        } catch (e) {
          console.error('[Postra:billing] checkout failed', e);
          toast.show(
            t(
              'billing_action_failed',
              'Something went wrong, please try again.'
            ),
            'warning'
          );
        } finally {
          reactivating.current = false;
          setLoading(false);
          // An upgrade or cancelling drops a waiting downgrade.
          refreshPending();
        }
      },
    [monthlyOrYearly, subscription, user, utm]
  );
  // Redirect lifetime users away from billing in an effect — calling
  // router.replace() during render triggers a setState-in-render warning.
  useEffect(() => {
    if (user?.isLifetime) {
      router.replace('/');
    }
  }, [user?.isLifetime, router]);

  if (user?.isLifetime) {
    return null;
  }
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-row">
        <div className="flex-1 text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
          {t('plans', 'Plans')}
        </div>
        <div className="flex items-center gap-[16px]">
          <div>{t('monthly', 'MONTHLY')}</div>
          <div>
            <Slider
              value={monthlyOrYearly}
              onChange={setMonthlyOrYearly}
              label={t('bill_yearly', 'Bill yearly')}
            />
          </div>
          <div>{t('yearly', 'YEARLY')}</div>
        </div>
      </div>

      {finishTrial && <FinishTrial close={() => setFinishTrial(false)} />}
      {!!user?.isTrailing && <TrialLimitsNote endTrialLink />}
      {!!subscription?.subscriptionTier && (
        <AiUsageThisMonth
          tier={subscription.subscriptionTier}
          isTrailing={!!user?.isTrailing}
        />
      )}
      <div className="flex gap-[16px] [@media(max-width:1024px)]:flex-col [@media(max-width:1024px)]:text-center">
        {Object.entries(pricing)
          .filter((f) => f[0] !== 'TEAM' && (!isGeneral || f[0] !== 'FREE'))
          .map(([name, values]) => (
            <Card
              key={name}
              className="flex-1 p-[24px] gap-[16px] flex flex-col [@media(max-width:1024px)]:items-center"
            >
              <div className="text-[18px]">{planLabel(name)}</div>
              <div className="text-[38px] flex gap-[2px] items-center">
                <div>
                  £
                  {monthlyOrYearly === 'on'
                    ? values.year_price
                    : values.month_price}
                </div>
                <div className={`text-[14px] text-newTextColor/55`}>
                  {monthlyOrYearly === 'on'
                    ? t('per_year', '/year')
                    : t('per_month', '/mo')}
                </div>
              </div>
              <div className="text-[14px] flex gap-[10px]">
                {currentPackage === name.toUpperCase() &&
                subscription?.cancelAt ? (
                  <div className="gap-[3px] flex flex-col">
                    <div>
                      <Button
                        onClick={moveToCheckout('FREE', true)}
                        loading={loading}
                      >
                        {t(
                          'reactivate_subscription',
                          'Reactivate subscription'
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    loading={loading}
                    disabled={
                      (!!subscription?.cancelAt &&
                        name.toUpperCase() === 'FREE') ||
                      currentPackage === name.toUpperCase()
                    }
                    variant={
                      subscription && name.toUpperCase() === 'FREE'
                        ? 'danger'
                        : undefined
                    }
                    onClick={moveToCheckout(
                      name.toUpperCase() as 'STANDARD' | 'PRO'
                    )}
                  >
                    {currentPackage === name.toUpperCase()
                      ? t('current_plan', 'Current plan')
                      : name.toUpperCase() === 'FREE'
                      ? subscription?.cancelAt
                        ? `${t('downgrade_on', 'Plan change')} ${dayjs
                            .utc(subscription?.cancelAt)
                            .local()
                            .format('D MMM, YYYY')}`
                        : t('cancel_subscription', 'Cancel Subscription')
                      : // @ts-expect-error user.tier is typed as PricingInnerInterface, compared to a string literal
                      (user?.tier === 'FREE' ||
                          user?.tier?.current === 'FREE') &&
                        user.allowTrial
                      ? t('start_7_days_free_trial', 'Start 7 days free trial')
                      : t('purchase', 'Purchase plan')}
                  </Button>
                )}
                {currentPackage === name.toUpperCase() &&
                  !subscription?.cancelAt &&
                  !!pending?.billing &&
                  !!pending?.on && (
                    <div className="self-center text-newTextColor/70">
                      {t('plan_pending_change', 'Changes to {{plan}} on {{date}}', {
                        plan: planLabel(pending.billing),
                        date: dayjs(pending.on).format('D MMMM'),
                      })}
                    </div>
                  )}
                {subscription &&
                  currentPackage !== name.toUpperCase() &&
                  name !== 'FREE' &&
                  !!name && (
                    <Prorate
                      period={monthlyOrYearly === 'on' ? 'YEARLY' : 'MONTHLY'}
                      pack={name.toUpperCase() as 'STANDARD' | 'PRO'}
                    />
                  )}
              </div>
              <Features
                pack={name.toUpperCase() as 'FREE' | 'STANDARD' | 'PRO'}
              />
            </Card>
          ))}
      </div>
      {!!subscription?.id && (
        <div className="flex justify-center mt-[20px] gap-[10px]">
          <Button onClick={updatePayment}>
            {t(
              'update_payment_method_invoices_history',
              'Update Payment Method / Invoices History'
            )}
          </Button>
          {isGeneral && !subscription?.cancelAt && (
            <Button
              variant="danger"
              loading={loading}
              onClick={moveToCheckout('FREE')}
            >
              {t('cancel_subscription_1', 'Cancel subscription')}
            </Button>
          )}
        </div>
      )}
      {/* Not tied to a live subscription: when one ends its row goes, and
          its invoices must stay reachable (Codex). Nothing shows without any. */}
      <BillingHistory />
      {subscription?.cancelAt && isGeneral && (
        <div className="text-center">
          {t(
            'your_subscription_will_be_canceled_at',
            'Your subscription will be canceled at'
          )}{' '}
          {newDayjs(subscription.cancelAt).local().format('D MMM, YYYY')}
          <br />
          {t(
            'you_will_never_be_charged_again',
            'You will never be charged again'
          )}
        </div>
      )}
      <FAQComponent />
      <div className="flex justify-center mt-[20px]">
        <LogoutComponent />
      </div>
    </div>
  );
};
