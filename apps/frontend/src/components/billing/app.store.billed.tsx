'use client';

import React, { FC } from 'react';
import { Subscription } from '@prisma/client';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { planLabels } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { TrialLimitsNote } from '@gitroom/frontend/components/billing/trial.limits.note';
import { AiUsageThisMonth } from '@gitroom/frontend/components/billing/ai.usage.this.month';
import { Card } from '@gitroom/frontend/components/ui/card';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';

// The Billing page of an organisation whose plan was bought in the iOS app.
// Apple bills it, so nothing here can change it: no plan cards, no checkout,
// no payment method, no cancel button. The page says where it is managed.
export const AppStoreBilled: FC<{ sub: Subscription; isTrailing: boolean }> = ({
  sub,
  isTrailing,
}) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]" data-testid="billing-app-store">
      <div className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
        {t('plans', 'Plans')}
      </div>
      {isTrailing && <TrialLimitsNote />}
      <AiUsageThisMonth tier={sub.subscriptionTier} isTrailing={isTrailing} />
      <Card className="p-[24px] gap-[8px] flex flex-col">
        <div className="text-[18px] font-[600] text-newTextColor">
          {planLabels[sub.subscriptionTier] || sub.subscriptionTier}
        </div>
        <div className="text-newTextColor">
          {t('billing_app_store_subscribed', 'Subscribed through the App Store')}
        </div>
        <div className="text-newTextColor/70">
          {t(
            'billing_app_store_manage',
            'Apple bills this plan. To change or cancel it, open Settings on your iPhone, tap your name, then Subscriptions.'
          )}
        </div>
        {sub.cancelAt && (
          <div className="text-newTextColor/70">
            {t('billing_app_store_ends', 'This plan ends on')}{' '}
            {fromUtc(sub.cancelAt).format('D MMM, YYYY')}
          </div>
        )}
      </Card>
    </div>
  );
};
