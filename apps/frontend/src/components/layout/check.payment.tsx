import { FC, ReactNode, useCallback, useEffect, useState } from 'react';
import Loading from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { timer } from '@gitroom/helpers/utils/timer';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useDecisionModal } from '@gitroom/frontend/components/layout/new-modal';
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
  // it up for good (E2E-07-17). Errors are retried, and after about two
  // minutes the app is handed back with a note.
  const checkSubscription = useCallback(async (attempt = 0): Promise<void> => {
    let status: number | undefined;
    try {
      status = (await (await fetch('/billing/check/' + props.check)).json())
        ?.status;
    } catch {
      status = undefined;
    }
    if (status !== 1 && status !== 2) {
      if (attempt < 120) {
        await timer(1000);
        return checkSubscription(attempt + 1);
      }
      setShowLoader(false);
      toaster.show(
        'We could not confirm the payment yet. It may still be processing — refresh this page in a minute.',
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
    if (status === 2) {
      setShowLoader(false);
      props.mutate();
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
