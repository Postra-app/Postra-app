'use client';

import React, { useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Card } from '@gitroom/frontend/components/ui/card';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';

// RODO right to erasure + Meta data-deletion. Calls POST /user/delete, which
// permanently removes the account and solely-owned organizations (incl. OAuth
// tokens). A session alone is not enough: with the account's password it
// deletes at once (200), without one the server emails a confirmation link
// (202) and /auth/delete-account/<token> finishes it. Requires typing a
// confirmation word either way.
const CONFIRM_WORD = 'DELETE';

const DeleteAccountComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const user = useUser();
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState('');

  // Accounts with their own password can prove it here; Google, Apple and
  // the other sign-ins confirm through the email.
  const hasPassword = user?.providerName === 'LOCAL';
  const confirmed = confirm.trim().toUpperCase() === CONFIRM_WORD;

  const deleteAccount = async () => {
    if (!confirmed || deleting) {
      return;
    }
    setDeleting(true);
    setError('');
    try {
      const res = await fetch('/user/delete', {
        method: 'POST',
        body: JSON.stringify(hasPassword && password ? { password } : {}),
      });
      if (res.status === 202) {
        setEmailed(true);
        setDeleting(false);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        setError(
          (typeof body?.message === 'string' && body.message) ||
            t('account_delete_failed', 'Could not delete the account. Please try again.')
        );
        setDeleting(false);
        return;
      }
      toaster.show(t('account_deleted', 'Your account has been deleted'), 'success');
      window.location.href = '/';
    } catch (e) {
      setDeleting(false);
      toaster.show(
        t('account_delete_failed', 'Could not delete the account. Please try again.'),
        'warning'
      );
    }
  };

  return (
    <Card className="my-[16px] p-[24px] flex flex-col gap-[16px] border border-[rgba(248,113,113,0.4)]">
      <div className="text-[15px] font-[600] text-[#fca5a5]">
        {t('danger_zone', 'Danger zone')}
      </div>
      <div className="text-[13px] text-newTextColor/70 max-w-[560px]">
        {t(
          'delete_account_description',
          'Permanently deleting your account erases your data, connected channels (including access tokens), scheduled posts and media. Organizations where you are the only member will be deleted entirely, and a subscription paid on this website is cancelled immediately. A subscription bought in the App Store is not cancelled: cancel it in Settings on your iPhone. This action cannot be undone. Billing records required by law are retained in line with our privacy policy.'
        )}
      </div>
      {emailed ? (
        <div
          className="text-[13.5px] text-newTextColor max-w-[560px]"
          role="status"
          data-testid="delete-account-emailed"
        >
          {t(
            'delete_account_check_email',
            'Check your email to confirm. We have sent a link to {{email}}. It expires in 1 hour, and nothing is deleted until you press the button on that page.',
            { email: user?.email || '' }
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-[8px] max-w-[420px]">
            <label className="text-[12px] text-newTextColor/55" htmlFor="confirm-delete-account">
              {t('type_to_confirm', 'Type')} <b>{CONFIRM_WORD}</b>{' '}
              {t('type_to_confirm_2', 'to confirm')}
            </label>
            <input
              id="confirm-delete-account"
              type="text"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={CONFIRM_WORD}
              className="h-[38px] px-[12px] rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-newTextColor text-[13.5px] outline-none focus:border-[rgba(248,113,113,0.5)]"
            />
          </div>
          {hasPassword ? (
            <div className="flex flex-col gap-[8px] max-w-[420px]">
              <label className="text-[12px] text-newTextColor/55" htmlFor="delete-account-password">
                {t('delete_account_password_label', 'Your password')}
              </label>
              <input
                id="delete-account-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-[38px] px-[12px] rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-newTextColor text-[13.5px] outline-none focus:border-[rgba(248,113,113,0.5)]"
              />
              <div className="text-[12px] text-newTextColor/55">
                {t(
                  'delete_account_password_hint',
                  'No password, or forgot it? Leave this empty and we will email you a link to confirm.'
                )}
              </div>
            </div>
          ) : (
            <div className="text-[12px] text-newTextColor/55 max-w-[560px]">
              {t(
                'delete_account_email_note',
                'To confirm, we will email you a link. Your account is deleted only after you open it and press the button.'
              )}
            </div>
          )}
          {error ? (
            <div className="text-[13px] text-[#fca5a5]" role="alert" data-testid="delete-account-error">
              {error}
            </div>
          ) : null}
          <div>
            <Button variant="danger" disabled={!confirmed} loading={deleting} onClick={deleteAccount}>
              {deleting
                ? t('deleting', 'Deleting…')
                : t('delete_my_account', 'Delete my account')}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
};

export default DeleteAccountComponent;
