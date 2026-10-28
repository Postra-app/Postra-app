import { FC, ReactNode, useCallback, useEffect, useState } from 'react';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { mutate as revalidate } from 'swr';
export const CheckPayment: FC<{
  check: string;
  mutate: () => void;
  children: ReactNode;
}> = (props) => {
  if (!props.check) {
    return <>{props.children}</>;
  }
  return <CheckPaymentInner {...props} />;
};

export const CheckPaymentInner: FC<{
  check: string;
  mutate: () => void;
  children: ReactNode;
}> = (props) => {
  const [showLoader, setShowLoader] = useState(true);
  const fetch = useFetch();
  const toaster = useToaster();
  const modal = useDecisionModal();
  const t = useT();

  useEffect(() => {
    if (showLoader) {
      document.querySelector('body')?.classList.add('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.add('blur-xs', 'pointer-events-none')
      );
    } else {
      document.querySelector('body')?.classList.remove('overflow-hidden');
      Array.from(document.querySelectorAll('.blurMe') || []).map((p) =>
        p.classList.remove('blur-xs', 'pointer-events-none')
      );
    }
  }, [showLoader]);

  // One failed request (a 503, a dropped connection) ended the polling with
  // the full-screen loader still up, and a payment that stayed pending kept
  // it up for good. Errors are retried, and after about two
  // minutes the app is handed back with a note.
  const checkSubscription = useCallback(async (attempt = 0): Promise<void> => {
    let status: number | undefined;
    try {
      status = (await (await fetch('/billing/check/' + props.check)).json())
        ?.status;
    } catch {
      status = undefined;
    }
    if (!status || status < 1 || status > 5) {
      if (attempt < 120) {
        await timer(1000);
        return checkSubscription(attempt + 1);
      }
      setShowLoader(false);
      toaster.show(
        'We could not confirm the payment yet. It may still be processing - refresh this page in a minute.',
        'warning'
      );
      return;
    }
    if (status === 1) {
      modal.open({
        title: 'Invalid payment',
        onlyApprove: true,
        approveLabel: 'OK',
        description:
          'We could not verify your payment method, please try again',
      });
      setShowLoader(false);
    }
    // The card (3) or email (4) already had a Postra trial, or the card had
    // no fingerprint to mark (5): nothing was charged and the offer is gone,
    // so reload the user and the page offers the plan without a trial
    // instead of "Invalid payment".
    if (status >= 3) {
      setShowLoader(false);
      props.mutate();
      // The checkout on the plan page is cached per plan and was opened with
      // the trial; load it again without.
      revalidate(
        (key) => typeof key === 'string' && key.startsWith('/billing-')
      );
      modal.open({
        title:
          status === 5
            ? t('free_trial_unavailable', 'Free trial not available')
            : t('free_trial_already_used', 'Free trial already used'),
        onlyApprove: true,
        approveLabel: t('ok', 'OK'),
        description:
          status === 3
            ? t(
                'free_trial_used_card',
                'This card has already been used for a Postra trial. Choose a plan to subscribe without a trial.'
              )
            : status === 4
            ? t(
                'free_trial_used_email',
                'This email address has already been used for a Postra trial. Choose a plan to subscribe without a trial.'
              )
            : t(
                'free_trial_no_card',
                'We could not confirm this card for a free trial, so nothing was charged. Choose a plan to subscribe without a trial.'
              ),
      });
    }
    // Answered: a reload must not run the check (and its message) again.
    if (status !== 2) {
      const url = new URL(window.location.href);
      url.searchParams.delete('check');
      window.history.replaceState(window.history.state, '', url.toString());
    }
    if (status === 2) {
      setShowLoader(false);
      props.mutate();
      // The webhook switches channels back on when the new plan covers all
      // of them (subscription.service applyTierLimits); say so when some stay
      // off, or a paying customer just sees greyed-out channels.
      try {
        const { integrations } = await (
          await fetch('/integrations/list')
        ).json();
        revalidate('/integrations/list');
        if ((integrations || []).some((c: { disabled?: boolean }) => c.disabled)) {
          modal.open({
            title: t('channels_still_disabled', 'Some channels are still disabled'),
            onlyApprove: true,
            approveLabel: t('ok', 'OK'),
            description: t(
              'channels_still_disabled_description',
              "Your plan doesn't cover all of your connected channels, so some stay disabled. Enable the ones you want from each channel's menu, up to your plan's limit, or upgrade your plan to use all of them."
            ),
          });
        }
      } catch {
        // the calendar still shows which channels are disabled
      }
    }
  }, []);
  useEffect(() => {
    checkSubscription();
  }, []);
  if (showLoader) {
    return (
      <div className="fixed bg-black/40 w-full h-full flex justify-center items-center z-[400]">
        <div>
          <Loading type="spin" color="#38bdf8" height={250} width={250} />
        </div>
      </div>
    );
  }
  return props.children;
};
