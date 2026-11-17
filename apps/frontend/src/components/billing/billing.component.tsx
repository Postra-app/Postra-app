'use client';

import { useCallback } from 'react';
import useSWR from 'swr';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { MainBillingComponent } from './main.billing.component';

export const BillingComponent = () => {
  const fetch = useFetch();
  const user = useUser();
  const t = useT();
  // A failed answer used to read as "no subscription": a paying organisation
  // saw three "Purchase plan" buttons, and a press changed the plan without
  // the window that shows the amount. Only a real answer reaches the plans.
  const load = useCallback(async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) {
      throw new Error(`subscription ${response.status}`);
    }
    return await response.json();
  }, []);
  // A member without billing rights is refused by the server on every
  // billing route; do not ask.
  const member = user?.role === 'USER';
  const {
    isLoading: isLoadingSubscription,
    data: subscription,
    error,
    mutate,
  } = useSWR(member ? null : '/user/subscription', load, {
    shouldRetryOnError: false,
  });
  if (member) {
    return (
      <div
        className="mx-auto max-w-[520px] text-center flex flex-col gap-[8px] py-[40px]"
        data-testid="billing-members-only"
      >
        <div className="text-[18px] font-[600]">
          {t('billing_admins_only_title', 'Plans are managed by an admin')}
        </div>
        <div className="text-newTextColor/70">
          {t(
            'billing_admins_only',
            'Only an admin of this organisation can change the plan or the payment details. Ask one of them to do it.'
          )}
        </div>
      </div>
    );
  }
  if (isLoadingSubscription) {
    return <LoadingComponent />;
  }
  if (error) {
    return (
      <div
        role="alert"
        className="mx-auto max-w-[520px] text-center flex flex-col items-center gap-[12px] py-[40px]"
      >
        <div className="text-[18px] font-[600]">
          {t('billing_load_failed_title', 'We could not load your plan')}
        </div>
        <div className="text-newTextColor/70">
          {t(
            'billing_load_failed',
            'Nothing has been changed. Please try again in a moment.'
          )}
        </div>
        <Button onClick={() => mutate()}>{t('try_again', 'Try again')}</Button>
      </div>
    );
  }
  return <MainBillingComponent sub={subscription?.subscription} />;
};
