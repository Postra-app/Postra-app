'use client';

import React, { FC, useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Textarea } from '@gitroom/react/form/textarea';
import { AdminButton as Button, withReason } from './admin-ui';

// Suspend an account: the user cannot sign in and every session ends at once.
// The reason is for the team (audit log, the user list), not shown to the user.
export const AdminSuspendModal: FC<{
  userId: string;
  email: string;
  close: () => void;
  onDone: () => void;
}> = ({ userId, email, close, onDone }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const suspend = useCallback(async () => {
    setBusy(true);
    const res = await fetch('/admin/suspend-user', {
      method: 'POST',
      body: JSON.stringify({ userId, value: true, reason }),
    });
    setBusy(false);
    if (!res.ok) {
      toaster.show(await withReason(res, t('admin_suspend_failed', 'Could not suspend the account')), 'warning');
      return;
    }
    toaster.show(t('admin_suspend_done', 'Account suspended'), 'success');
    close();
    onDone();
  }, [fetch, userId, reason, toaster, t, close, onDone]);

  return (
    <div className="flex flex-col gap-[12px]">
      <p className="text-[14px] text-newTextColor/80">
        {t(
          'admin_suspend_explain',
          `${email} will be signed out everywhere and will not be able to sign in. Their organisations, posts and channels stay as they are; to stop an organisation publishing, disable its channels in the Channels tab.`
        )}
      </p>
      <Textarea
        name="reason"
        disableForm={true}
        label={t('admin_suspend_reason', 'Reason (for the team, not shown to the user)')}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        className="!min-h-[90px]"
      />
      <div className="flex gap-[8px] justify-end">
        <Button secondary onClick={close}>
          {t('admin_cancel', 'Cancel')}
        </Button>
        <Button variant="danger" loading={busy} onClick={suspend}>
          {t('admin_suspend', 'Suspend account')}
        </Button>
      </div>
    </div>
  );
};
