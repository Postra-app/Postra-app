'use client';

import React, { FC } from 'react';
import { Subscription } from '@prisma/client';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { planLabels } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { AiUsageThisMonth } from '@gitroom/frontend/components/billing/ai.usage.this.month';
import { Card } from '@gitroom/frontend/components/ui/card';
import { fromUtc } from '@gitroom/frontend/components/layout/set.timezone';

// The Billing page of an organisation whose plan Postra gave (a comp: an
// influencer, a tester, a compensation). Nobody pays for it, so there is
// nothing to cancel: "Cancel Subscription" answered with silence. The page
// says where the plan comes from and when it ends.
export const CompBilled: FC<{ sub: Subscription }> = ({ sub }) => {
  const t = useT();
  return (
    <div className="flex flex-col gap-[16px]" data-testid="billing-comp">
      <div className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
        {t('plans', 'Plans')}
      </div>
      <AiUsageThisMonth tier={sub.subscriptionTier} isTrailing={false} />
      <Card className="p-[24px] gap-[8px] flex flex-col">
        <div className="text-[18px] font-[600] text-newTextColor">
          {planLabels[sub.subscriptionTier] || sub.subscriptionTier}
        </div>
        <div className="text-newTextColor">
          {t('billing_comp_given', 'Postra gave you this plan. There is nothing to pay and nothing to cancel.')}
        </div>
        <div className="text-newTextColor/70">
          {sub.compEndsAt
            ? `${t('billing_comp_ends', 'It ends on')} ${fromUtc(sub.compEndsAt).format('D MMMM YYYY')}.`
            : t('billing_comp_no_end', 'It has no end date.')}
        </div>
      </Card>
    </div>
  );
};
