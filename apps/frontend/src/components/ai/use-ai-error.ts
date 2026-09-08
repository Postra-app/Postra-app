'use client';

import { useCallback } from 'react';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Every AI call in the product failed differently: a 201 carrying `false`, a
// blocking alert(), a generic "try again" on top of a 402. "Try again" is
// wrong advice when the answer is out of credits or not on your plan, so all
// of them now report the same four outcomes from one place.
export const useAiError = () => {
  const toaster = useToaster();
  const t = useT();

  return useCallback(
    async (response: Response, fallback: string) => {
      let serverMessage = '';
      try {
        const body = await response.clone().json();
        serverMessage = typeof body?.message === 'string' ? body.message : '';
      } catch {
        // non-JSON body — fall through to the generic copy
      }

      // The server knows which allowance ran out (images, video); prefer its
      // wording and fall back to the neutral one.
      if (response.status === 402) {
        toaster.show(
          serverMessage ||
            t(
              'ai_no_credits',
              'You are out of AI credits for this billing cycle. Upgrade your plan or wait for the next one.'
            ),
          'warning'
        );
        return;
      }
      if (response.status === 401 || response.status === 403) {
        toaster.show(
          t(
            'ai_forbidden',
            'AI is not available on your plan. Check your subscription settings.'
          ),
          'warning'
        );
        return;
      }
      if (response.status === 429) {
        toaster.show(
          t(
            'ai_rate_limited',
            'Too many requests — wait a few seconds and try again.'
          ),
          'warning'
        );
        return;
      }

      toaster.show(serverMessage || fallback, 'warning');
    },
    [toaster, t]
  );
};
