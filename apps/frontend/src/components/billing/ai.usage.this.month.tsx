'use client';

import { FC, useCallback } from 'react';
import useSWR from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import {
  pricing,
  trialAiAllowance,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// What is left of this billing month's AI images and videos, next to the plan
// cards — the composer shows a count only once its modal is open.
export const AiUsageThisMonth: FC<{ tier: string; isTrailing?: boolean }> = ({
  tier,
  isTrailing,
}) => {
  const t = useT();
  const fetch = useFetch();
  const plan = pricing[tier];
  const credits = useCallback(
    async (type: string) =>
      (await (await fetch(`/copilot/credits?type=${type}`)).json())
        ?.credits as number,
    []
  );
  const { data: images } = useSWR('billing-credits-images', () =>
    credits('ai_images')
  );
  const { data: videos } = useSWR('billing-credits-videos', () =>
    credits('ai_videos')
  );

  if (!plan) {
    return null;
  }
  const rows = [
    {
      total: trialAiAllowance(
        plan.image_generation_count,
        isTrailing,
        'image_generation_count'
      ),
      left: images,
      key: 'billing_ai_images_left',
      text: '{{left}} of {{total}} AI images left',
    },
    {
      total: trialAiAllowance(
        plan.generate_videos,
        isTrailing,
        'generate_videos'
      ),
      left: videos,
      key: 'billing_ai_videos_left',
      text: '{{left}} of {{total}} AI videos left',
    },
  ].filter((r) => r.total > 0 && typeof r.left === 'number');

  if (!rows.length) {
    return null;
  }
  const title = t('billing_this_month', 'This month');
  return (
    <section
      aria-label={title}
      className="flex flex-wrap items-center gap-x-[24px] gap-y-[4px] text-[14px]"
    >
      <h3 className="font-[600]">{title}</h3>
      {rows.map((r) => (
        <div key={r.key}>
          {t(r.key, r.text, {
            left: Math.max(0, r.left as number),
            total: r.total,
          })}
        </div>
      ))}
    </section>
  );
};
