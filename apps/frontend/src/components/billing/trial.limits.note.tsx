'use client';

import { FC } from 'react';
import {
  pricing,
  TRIAL_CHANNEL_CAP,
  TRIAL_VIDEO_CLIPS,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// A trial runs on Starter's limits whatever plan was picked (channelLimitFor and
// trialAiAllowance in pricing.ts), with one AI video clip. Said out loud, so a
// Pro or Business trial does not meet a 402 at the fourth channel without
// knowing why.
export const TrialLimitsNote: FC<{ endTrialLink?: boolean }> = ({
  endTrialLink,
}) => {
  const t = useT();
  return (
    <div className="text-[14px] text-newTextColor/70 max-w-[760px]">
      {t(
        'billing_trial_limits',
        "During the 7-day trial you can connect up to {{channels}} channels and use Starter's AI allowance ({{images}} AI images, {{videos}} AI video); your full plan unlocks with the first payment, or straight away if you end the trial early.",
        {
          channels: TRIAL_CHANNEL_CAP,
          images: pricing.STANDARD.image_generation_count,
          videos: TRIAL_VIDEO_CLIPS,
        }
      )}
      {endTrialLink && (
        <>
          {' '}
          <a className="underline" href="/billing?finishTrial=true">
            {t('billing_end_trial_now', 'End the trial now')}
          </a>
        </>
      )}
    </div>
  );
};
