'use client';

import { FC, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

type Outcome =
  | { kind: 'working' }
  | { kind: 'done'; name: string }
  | { kind: 'failed'; message: string };

// Where TikTok sends the browser after the second authorization that turns
// first comment on for a TikTok channel (the channel menu starts it). The
// code is sent to the backend once; the answer is shown here.
export const TiktokCommentsReturn: FC<{ code: string; state: string }> = ({
  code,
  state,
}) => {
  const t = useT();
  const fetch = useFetch();
  const { push } = useRouter();
  const sent = useRef(false);
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'working' });

  useEffect(() => {
    if (sent.current) {
      return;
    }
    sent.current = true;

    const declined = t(
      'tiktok_comments_declined',
      'First comment was not turned on: the TikTok sign-in was not finished. You can start again from the channel menu.'
    );
    if (!code || !state) {
      setOutcome({ kind: 'failed', message: declined });
      return;
    }

    (async () => {
      try {
        const response = await fetch('/integrations/tiktok-comments/connect', {
          method: 'POST',
          body: JSON.stringify({ code, state }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok) {
          setOutcome({ kind: 'done', name: String(body?.name || 'TikTok') });
          return;
        }
        setOutcome({
          kind: 'failed',
          message:
            typeof body?.message === 'string' && body.message
              ? body.message
              : declined,
        });
      } catch {
        setOutcome({ kind: 'failed', message: declined });
      }
    })();
  }, []);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-[16px] p-[24px] text-center">
      {outcome.kind === 'working' && (
        <div className="text-[16px]" data-testid="tiktok-comments-working">
          {t('tiktok_comments_working', 'Turning first comment on...')}
        </div>
      )}
      {outcome.kind === 'done' && (
        <>
          <div className="text-[20px] font-[600]" data-testid="tiktok-comments-done">
            {t('tiktok_comments_done_title', 'First comment is on')}
          </div>
          <div className="text-[14px] max-w-[460px]">
            {t(
              'tiktok_comments_done_text',
              'Posts you publish to this TikTok channel can now have a first comment. TikTok shows it once the post is public.'
            )}{' '}
            ({outcome.name})
          </div>
        </>
      )}
      {outcome.kind === 'failed' && (
        <>
          <div className="text-[20px] font-[600]" data-testid="tiktok-comments-failed">
            {t('tiktok_comments_failed_title', 'First comment was not turned on')}
          </div>
          <div className="text-[14px] max-w-[460px]">{outcome.message}</div>
        </>
      )}
      {outcome.kind !== 'working' && (
        <Button onClick={() => push('/launches')}>
          {t('back_to_calendar', 'Back to the calendar')}
        </Button>
      )}
    </div>
  );
};
