'use client';

import { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// Global "you are impersonating" strip. Without it the only Stop button lived
// two clicks away in Admin -> Users, which reads like being logged into the
// user's account with no way back.
export const ImpersonationBanner: FC<{ email?: string }> = ({ email }) => {
  const fetch = useFetch();
  const t = useT();

  const [failed, setFailed] = useState(false);

  const stop = useCallback(async () => {
    const res = await fetch('/user/impersonate', {
      method: 'POST',
      body: JSON.stringify({ id: '' }),
    });
    // Navigating regardless would land on a page that looks like the admin's
    // own while the session is still the customer's (E2E-09-08).
    if (!res.ok) {
      setFailed(true);
      return;
    }
    window.location.href = '/admin/users';
  }, []);

  return (
    // Announced, not just shown. The whole point of this strip is "remember
    // that this is not you", and without a live region someone using a screen
    // reader was never told (E2E-09-57).
    <div
      role="status"
      aria-live="polite"
      className="sticky top-0 z-[200] flex items-center justify-center gap-[12px] bg-amber-400 text-black text-[13px] font-[600] px-[16px] py-[8px] rounded-[10px] mb-[8px]"
    >
      <span>
        {t('admin_impersonating_as', 'Impersonating')}
        {email ? ` ${email}` : ''} — {t('admin_impersonating_note', 'actions are real')}
      </span>
      {failed && (
        <span role="alert">
          {t('admin_stop_impersonating_failed', 'Could not stop — try again.')}
        </span>
      )}
      <button
        type="button"
        onClick={stop}
        className="px-[12px] py-[3px] rounded-[6px] bg-black text-white text-[12px] cursor-pointer hover:opacity-80 transition-opacity"
      >
        {t('admin_stop_impersonating', 'Stop')}
      </button>
    </div>
  );
};
