'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// The second step of deleting an account without its password. A mail
// scanner opens links but does not press buttons, so the POST waits for the
// click: deleting on page load would let any link checker erase the account.
export function DeleteAccountConfirm({ token }: { token: string }) {
  const t = useT();
  const fetch = useFetch();
  const [state, setState] = useState<'ask' | 'deleting' | 'done'>('ask');
  const [error, setError] = useState('');

  const confirm = async () => {
    if (state !== 'ask') return;
    setState('deleting');
    setError('');
    try {
      const res = await fetch('/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let message = '';
        try {
          message = JSON.parse(text)?.message || '';
        } catch {
          message = text;
        }
        setError(
          message ||
            t(
              'delete_account_link_invalid',
              'This link is not valid or has expired. Ask for a new one in Settings.'
            )
        );
        setState('ask');
        return;
      }
      setState('done');
    } catch (e) {
      setError(
        isFetchHandledError(e) && e.status === 429
          ? t(
              'forgot_too_many_attempts',
              'Too many attempts - please wait a few minutes and try again.'
            )
          : t(
              'account_delete_failed',
              'Could not delete the account. Please try again.'
            )
      );
      setState('ask');
    }
  };

  return (
    <div className="flex flex-col gap-[16px] w-full">
      <h1 className="text-start text-[32px] font-[700] tracking-[-0.04em] text-white">
        {state === 'done'
          ? t('account_deleted', 'Your account has been deleted')
          : t('delete_account_confirm_title', 'Delete your Postra account?')}
      </h1>
      {state === 'done' ? (
        <p className="text-[15px] text-textColor/70" data-testid="delete-account-done">
          {t(
            'delete_account_done_text',
            'Your account and its data are gone, and any subscription was cancelled. We have sent you an email to confirm it.'
          )}
        </p>
      ) : (
        <>
          <p className="text-[15px] text-textColor/70">
            {t(
              'delete_account_confirm_text',
              'This erases your data, connected channels, scheduled posts and media, and cancels any subscription. It cannot be undone.'
            )}
          </p>
          {error ? (
            <p className="text-[14px] text-[#fca5a5]" role="alert" data-testid="delete-account-error">
              {error}
            </p>
          ) : null}
          <Button
            variant="danger"
            className="rounded-[12px] !h-[52px]"
            loading={state === 'deleting'}
            onClick={confirm}
            data-testid="delete-account-confirm"
          >
            {t('delete_my_account', 'Delete my account')}
          </Button>
        </>
      )}
      <p className="text-sm text-textColor/66">
        <Link
          href="/"
          className="underline underline-offset-4 cursor-pointer hover:text-[#38bdf8]"
        >
          {state === 'done'
            ? t('delete_account_back_home', 'Back to Postra')
            : t('delete_account_keep', 'Keep my account')}
        </Link>
      </p>
    </div>
  );
}
