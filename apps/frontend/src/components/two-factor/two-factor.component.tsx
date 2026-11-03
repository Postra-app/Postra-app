'use client';

import React, { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Card } from '@gitroom/frontend/components/ui/card';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

// The second step of a Postra administrator's sign-in (backend
// admin-mfa.controller.ts). The first visit scans a QR code into an
// authenticator app and keeps ten backup codes; every later session types a
// code from the app (or one backup code) before the admin panel opens.

type Status = {
  required: boolean;
  enabled: boolean;
  verified: boolean;
  backupCodesLeft: number;
};

type Setup = { secret: string; uri: string; qrSvg: string };

// Back to where /admin was asked for, never off the panel.
const safeNext = (next: string | null) =>
  next && /^\/admin(\/|\?|$)/.test(next) ? next : '/admin/stats';

const inputClass =
  'h-[42px] px-[12px] rounded-[10px] bg-white/[0.06] border border-white/[0.12] text-newTextColor text-[16px] tracking-[0.12em] outline-none focus:border-[#38bdf8]/60 w-[220px]';

export const TwoFactorComponent = () => {
  const t = useT();
  const fetch = useFetch();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));

  const [status, setStatus] = useState<Status | null>(null);
  const [setup, setSetup] = useState<Setup | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/two-factor');
    if (res.ok) {
      setStatus(await res.json());
    }
  }, [fetch]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (status?.verified && !backupCodes) {
      window.location.href = next;
    }
  }, [status, backupCodes, next]);

  const startSetup = async () => {
    setBusy(true);
    setError('');
    const res = await fetch('/two-factor/setup', { method: 'POST' });
    setBusy(false);
    if (!res.ok) {
      setError(await res.text());
      return;
    }
    setSetup(await res.json());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !code.trim()) {
      return;
    }
    setBusy(true);
    setError('');
    const res = await fetch(status?.enabled ? '/two-factor/verify' : '/two-factor/enable', {
      method: 'POST',
      body: JSON.stringify({ code: code.trim() }),
    });
    setBusy(false);
    if (!res.ok) {
      let message = '';
      try {
        message = (await res.json())?.message;
      } catch {
        // not JSON
      }
      setError(
        res.status === 429
          ? t('two_factor_locked', 'Too many wrong codes. Try again in 15 minutes.')
          : message || t('two_factor_wrong', 'That code is not right.')
      );
      setCode('');
      return;
    }
    const body = await res.json();
    if (body.backupCodes) {
      setBackupCodes(body.backupCodes);
      return;
    }
    window.location.href = next;
  };

  if (!status) {
    return null;
  }

  if (!status.required) {
    return (
      <div className="flex-1 flex items-center justify-center text-newTextColor/60">
        {t('no_access', 'You do not have access to this page.')}
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-start justify-center p-[24px]">
      <Card className="w-full max-w-[520px] p-[28px] flex flex-col gap-[18px]">
        <h2 className="text-[18px] font-[600] text-newTextColor">
          {t('two_factor_title', 'Two-step verification')}
        </h2>

        {backupCodes ? (
          <>
            <div className="text-[13.5px] text-newTextColor/75">
              {t(
                'two_factor_backup_intro',
                'Your authenticator is on. Keep these backup codes somewhere safe, away from your phone. Each one works once if you lose the phone. They are shown only now.'
              )}
            </div>
            <div
              data-testid="two-factor-backup-codes"
              className="grid grid-cols-2 gap-[8px] font-mono text-[14px] text-newTextColor bg-white/[0.04] rounded-[10px] p-[16px]"
            >
              {backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
            <div>
              <Button onClick={() => (window.location.href = next)}>
                {t('two_factor_saved_codes', 'I have saved them, open the admin panel')}
              </Button>
            </div>
          </>
        ) : !status.enabled && !setup ? (
          <>
            <div className="text-[13.5px] text-newTextColor/75">
              {t(
                'two_factor_setup_intro',
                'The admin panel needs a code from an authenticator app (Google Authenticator, 1Password, Authy or similar) on top of your password. Set it up once; after that you type a code at the start of each admin session.'
              )}
            </div>
            <div>
              <Button loading={busy} onClick={startSetup}>
                {t('two_factor_setup', 'Set up the authenticator')}
              </Button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-[16px]">
            {setup && (
              <>
                <div className="text-[13.5px] text-newTextColor/75">
                  {t(
                    'two_factor_scan',
                    'Scan this code with your authenticator app, then type the six-digit code it shows.'
                  )}
                </div>
                <img
                  data-testid="two-factor-qr"
                  alt={t('two_factor_qr_alt', 'QR code for the authenticator app')}
                  className="w-[200px] h-[200px] bg-white rounded-[8px] p-[6px]"
                  src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`}
                />
                <div className="text-[12px] text-newTextColor/55">
                  {t('two_factor_manual', 'Cannot scan? Enter this key in the app:')}{' '}
                  <code data-testid="two-factor-secret" className="text-newTextColor break-all">
                    {setup.secret}
                  </code>
                </div>
              </>
            )}
            {status.enabled && (
              <div className="text-[13.5px] text-newTextColor/75">
                {t(
                  'two_factor_enter',
                  'Type the six-digit code from your authenticator app, or one of your backup codes.'
                )}
              </div>
            )}
            <input
              data-testid="two-factor-code"
              autoFocus
              autoComplete="one-time-code"
              inputMode={status.enabled ? 'text' : 'numeric'}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className={inputClass}
              aria-label={t('two_factor_code', 'Authentication code')}
            />
            {error && (
              <div role="alert" className="text-[13px] text-[#fca5a5]">
                {error}
              </div>
            )}
            <div>
              <Button type="submit" loading={busy} disabled={!code.trim()}>
                {status.enabled
                  ? t('two_factor_verify', 'Verify')
                  : t('two_factor_turn_on', 'Turn on')}
              </Button>
            </div>
            {status.enabled && status.backupCodesLeft <= 3 && (
              <div className="text-[12px] text-newTextColor/55">
                {t('two_factor_backup_left', 'Backup codes left:')} {status.backupCodesLeft}
              </div>
            )}
          </form>
        )}
      </Card>
    </div>
  );
};
