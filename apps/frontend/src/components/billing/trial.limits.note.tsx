'use client';

import { FC } from 'react';
import {
  TRIAL_DAYS,
  TRIAL_CHANNEL_CAP,
  TRIAL_LIMITS,
  TRIAL_AGENT_MESSAGES,
  TRIAL_AI_IMAGES,
  TRIAL_VIDEO_CLIPS,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// A trial is held to channelLimitFor, trialAiAllowance and TRIAL_LIMITS in
// pricing.ts whatever plan was picked. Every limit said out loud, so a Pro
// or Business trial does not meet a 402 at the fourth
// channel, the 31st post or the second webhook without knowing why.
export const TrialLimitsNote: FC<{ endTrialLink?: boolean }> = ({
  endTrialLink,
}) => {
  const t = useT();
  return (
    <div className="text-[14px] text-newTextColor/70 max-w-[760px]">
      {t(
        'billing_free_trial_limits',
        "During the {{days}}-day trial you can connect up to {{channels}} channels, schedule up to {{posts}} posts, add {{webhooks}} webhook and {{feeds}} Auto Post feed, try AI with {{images}} AI images, {{videos}} AI video and {{questions}} questions to the AI assistant, and keep up to {{storage}} GB of photos and videos. The trial is for one person, so team invites open with your plan. Your plan's full limits start with your first payment: add a card to keep your plan after the trial, or end the trial early to start it now.",
        {
          days: TRIAL_DAYS,
          channels: TRIAL_CHANNEL_CAP,
          posts: TRIAL_LIMITS.posts_per_month,
          webhooks: TRIAL_LIMITS.webhooks,
          feeds: TRIAL_LIMITS.autoPostLimit,
          images: TRIAL_AI_IMAGES,
          questions: TRIAL_AGENT_MESSAGES,
          videos: TRIAL_VIDEO_CLIPS,
          storage: TRIAL_LIMITS.media_storage_gb,
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
