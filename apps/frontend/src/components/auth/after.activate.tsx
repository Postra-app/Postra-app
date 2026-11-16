'use client';

import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Input } from '@gitroom/react/form/input';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { FormProvider, useForm } from 'react-hook-form';
import Link from 'next/link';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';

// The activation link opened in a browser other than the one the sign-up was
// made in: the address is confirmed, and the password chosen at sign-up
// activates the account and signs in, in one step. Someone who did not sign
// up (a stranger used their address) or does not remember the password
// chooses a new one instead.
const ActivateSignIn = ({
  code,
  email,
  datafast_visitor_id,
}: {
  code: string;
  email: string;
  datafast_visitor_id?: string;
}) => {
  const fetch = useFetch();
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<{ email: string; password: string }>({
    defaultValues: { email, password: '' },
  });

  const signIn = form.handleSubmit(async ({ password }) => {
    if (!password) {
      setError(t('activate_password_required', 'Enter your password.'));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/auth/activate/sign-in', {
        method: 'POST',
        body: JSON.stringify({ code, password, datafast_visitor_id }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const { can } = await response.json();
        if (!can) {
          window.location.replace('/auth/login');
        }
        // Signed in: the `onboarding` header takes the page on.
        return;
      }
      setError(
        response.status === 400
          ? await response.text()
          : t(
              'login_failed_try_again',
              'Something went wrong, please try again.'
            )
      );
    } catch (e) {
      setError(
        isFetchHandledError(e) && e.status === 429
          ? t(
              'too_many_login_attempts',
              'Too many attempts - please wait a few minutes and try again.'
            )
          : t(
              'login_failed_try_again',
              'Something went wrong, please try again.'
            )
      );
    }
    setLoading(false);
  });

  const choosePassword = useCallback(async () => {
    setResetting(true);
    setError(null);
    try {
      const response = await fetch('/auth/activate/reset', {
        method: 'POST',
        body: JSON.stringify({ code, datafast_visitor_id }),
        headers: { 'Content-Type': 'application/json' },
      });
      if (response.ok) {
        const { setPassword } = await response.json();
        window.location.replace(
          setPassword
            ? `/auth/forgot/${encodeURIComponent(setPassword)}?confirmed=1`
            : '/auth/login'
        );
        return;
      }
      setError(await response.text());
    } catch (e) {
      setError(
        t('login_failed_try_again', 'Something went wrong, please try again.')
      );
    }
    setResetting(false);
  }, [code, datafast_visitor_id, fetch, t]);

  return (
    <FormProvider {...form}>
      <form onSubmit={signIn} data-testid="activate-sign-in">
        <h1 className="mb-4 text-start text-[40px] font-[700] tracking-[-0.04em] text-white">
          {t('activate_sign_in_title', 'Email confirmed')}
        </h1>
        <p className="mb-6 text-[15px] text-textColor/58">
          {t(
            'activate_sign_in_subtitle',
            'Sign in with the password you chose when you signed up to finish activating your account.'
          )}
        </p>
        <div className="flex flex-col gap-[12px] text-textColor">
          <Input
            label="Email"
            translationKey="label_email"
            name="email"
            type="email"
            autoComplete="email"
            readOnly
          />
          <Input
            label="Password"
            translationKey="label_password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder={t('label_password', 'Password')}
            autoFocus
          />
        </div>
        {error && (
          <p className="mt-3 text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex">
          <Button
            type="submit"
            className="flex-1 rounded-[12px] !h-[52px]"
            loading={loading}
          >
            {t('sign_in_1', 'Sign in')}
          </Button>
        </div>
        <p className="mt-4 text-center text-sm text-textColor/66">
          <button
            type="button"
            onClick={choosePassword}
            disabled={resetting}
            className="underline underline-offset-4 hover:text-[#38bdf8] disabled:opacity-60"
          >
            {t(
              'activate_choose_new_password',
              "I didn't sign up, or forgot my password"
            )}
          </button>
        </p>
      </form>
    </FormProvider>
  );
};

export const AfterActivate = () => {
  const fetch = useFetch();
  const params = useParams();
  const [showLoader, setShowLoader] = useState(true);
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState(false);
  const [signInAs, setSignInAs] = useState<string | null>(null);
  const run = useRef(false);
  const t = useT();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');

  useEffect(() => {
    if (!run.current) {
      run.current = true;
      loadCode();
    }
  }, []);
  const loadCode = useCallback(async () => {
    if (params.code) {
      try {
        const response = await fetch(`/auth/activate`, {
          method: 'POST',
          body: JSON.stringify({
            code: params.code,
            datafast_visitor_id,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
        });
        // A bad/expired code never resolves to `can`: don't mislead the
        // user into thinking the account is "already activated".
        if (!response.ok) {
          console.error('[Postra:auth] activate failed', response.status);
          setFailed(true);
          setShowLoader(false);
          return;
        }
        const { can, kept, signIn, email } = await response.json();
        // Opened somewhere other than the browser the sign-up was made in:
        // the password chosen at sign-up finishes the activation here.
        if (signIn && email) {
          setSignInAs(email);
          setShowLoader(false);
          return;
        }
        if (kept) {
          setKept(true);
        }
        if (!can || kept) {
          setShowLoader(false);
        }
      } catch (e) {
        console.error('[Postra:auth] activate failed', e);
        setFailed(true);
        setShowLoader(false);
      }
    }
  }, []);
  if (signInAs) {
    return (
      <ActivateSignIn
        code={String(params.code)}
        email={signInAs}
        datafast_visitor_id={datafast_visitor_id}
      />
    );
  }
  return (
    <>
      {showLoader ? (
        <LoadingComponent />
      ) : (
        <div className="rounded-[16px] border border-white/8 bg-white/[0.03] p-[18px] text-textColor/78">
          {failed
            ? t(
                'activation_link_invalid',
                'This activation link is invalid or has expired.'
              )
            : kept
            ? t(
                'activated_still_signed_in',
                'The account is activated. You are still signed in to your current account; sign out to use the new one.'
              )
            : t('user_already_activated', 'This user is already activated')}
          <br />
          <Link
            href="/auth/login"
            className="underline underline-offset-4 hover:text-[#38bdf8]"
          >
            {t(
              'click_here_to_go_back_to_login',
              'Click here to go back to login'
            )}
          </Link>
        </div>
      )}
    </>
  );
};
