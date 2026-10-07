'use client';

import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import Link from 'next/link';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Input } from '@gitroom/react/form/input';
import { Checkbox } from '@gitroom/react/form/checkbox';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { GithubProvider } from '@gitroom/frontend/components/auth/providers/github.provider';
import { useRouter, useSearchParams } from 'next/navigation';
import { LoadingComponent } from '@gitroom/frontend/components/layout/loading';
import clsx from 'clsx';
import { GoogleProvider } from '@gitroom/frontend/components/auth/providers/google.provider';
import { OauthProvider } from '@gitroom/frontend/components/auth/providers/oauth.provider';
import { useFireEvents } from '@gitroom/helpers/utils/use.fire.events';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useTrack } from '@gitroom/react/helpers/use.track';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import useCookie from 'react-use-cookie';
type Inputs = {
  email: string;
  password: string;
  confirmPassword: string;
  company: string;
  providerToken: string;
  provider: string;
  termsAccepted: boolean;
};

// Lightweight, dependency-free strength heuristic (length + character classes).
// This is a UX hint only — the real password policy (min 8 + HIBP breach check)
// is enforced server-side on /auth/register.
function passwordScore(password: string): number {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(score, 4);
}
export function Register() {
  const getQuery = useSearchParams();
  const fetch = useFetch();
  const { disableRegistration } = useVariables();
  const [provider] = useState(getQuery?.get('provider')?.toUpperCase());
  const [code, setCode] = useState(getQuery?.get('code') || '');
  const [state] = useState(getQuery?.get('state') || '');
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (provider && code) {
      load();
    }
  }, []);
  const load = useCallback(async () => {
    const { token, login } = await (
      await fetch(`/auth/oauth/${provider?.toUpperCase() || 'LOCAL'}/exists`, {
        method: 'POST',
        body: JSON.stringify({
          code,
          state,
        }),
      })
    ).json();
    // Existing account — the backend already set the auth cookie.
    if (login) {
      window.location.href = '/';
      return;
    }
    if (token) {
      setCode(token);
      setShow(true);
    }
  }, [provider, code, state]);
  // Defence in depth: proxy.ts already 302s /auth/register to /auth/login while
  // DISABLE_REGISTRATION is on, and the backend refuses the POST. This covers the
  // page being reached without the middleware (and makes the closure legible).
  if (disableRegistration) {
    return <RegistrationClosed />;
  }
  if (!code && !provider) {
    return <RegisterAfter token="" provider="LOCAL" />;
  }
  if (!show) {
    return <LoadingComponent />;
  }
  return (
    <RegisterAfter token={code} provider={provider?.toUpperCase() || 'LOCAL'} />
  );
}
function RegistrationClosed() {
  const t = useT();
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="cursor-pointer text-start text-[40px] font-[700] tracking-[-0.04em] text-white">
        {t('registration_closed_title', 'Sign-ups are closed')}
      </h1>
      <p className="mt-[8px] text-[15px] text-textColor/58">
        {t(
          'registration_closed_body',
          'Postra is not accepting new accounts right now. If you already have an account you can still sign in.'
        )}
      </p>
      <p className="mt-[24px] text-sm text-textColor/66">
        <Link
          href="/auth/login"
          className="underline underline-offset-4 cursor-pointer text-textColor hover:text-[#38bdf8]"
        >
          {t('sign_in', 'Sign In')}
        </Link>
      </p>
    </div>
  );
}
function getHelpfulReasonForRegistrationFailure(httpCode: number) {
  switch (httpCode) {
    case 400:
      return 'This email is already taken';
    case 404:
      return 'Your browser got a 404 when trying to contact the API, the most likely reasons for this are the NEXT_PUBLIC_BACKEND_URL is set incorrectly, or the backend is not running.';
  }
  return 'Unhandled error: ' + httpCode;
}
export function RegisterAfter({
  token,
  provider,
}: {
  token: string;
  provider: string;
}) {
  const t = useT();
  const { isGeneral, genericOauth } = useVariables();
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const fireEvents = useFireEvents();
  const track = useTrack();
  const [datafast_visitor_id] = useCookie('datafast_visitor_id');
  const searchParams = useSearchParams();
  // Market signal from the landing CTA (postra.co.uk → ?region=uk). Persisted to a
  // cookie so it survives the OAuth round-trip, then sent at submit to tag the org.
  const [regionCookie, setRegionCookie] = useCookie('postra_region', '');
  useEffect(() => {
    const r = searchParams?.get('region')?.toUpperCase();
    if (r === 'PL' || r === 'UK') {
      setRegionCookie(r);
    }
  }, [searchParams]);
  const isAfterProvider = useMemo(() => {
    return !!token && !!provider;
  }, [token, provider]);
  const resolver = useMemo(() => {
    return classValidatorResolver(CreateOrgUserDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
    defaultValues: {
      providerToken: token,
      provider: provider,
      termsAccepted: false,
    },
  });
  const fetchData = useFetch();
  const passwordValue = form.watch('password') || '';
  const strength = useMemo(() => passwordScore(passwordValue), [passwordValue]);
  const strengthMeta = [
    { label: t('password_weak', 'Weak'), color: '#f87171' },
    { label: t('password_weak', 'Weak'), color: '#f87171' },
    { label: t('password_fair', 'Fair'), color: '#fbbf24' },
    { label: t('password_good', 'Good'), color: '#38bdf8' },
    { label: t('password_strong', 'Strong'), color: '#34d399' },
  ][strength];
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    // confirmPassword is a client-only UX guard (not part of CreateOrgUserDto).
    if (!isAfterProvider && data.password !== data.confirmPassword) {
      form.setError('confirmPassword', {
        message: t('passwords_do_not_match', 'Passwords do not match'),
      });
      return;
    }
    setLoading(true);
    const region =
      searchParams?.get('region')?.toUpperCase() || regionCookie || '';
    const { confirmPassword, ...payload } = data;
    await fetchData('/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        datafast_visitor_id,
        ...(region === 'PL' || region === 'UK' ? { region } : {}),
      }),
    })
      .then(async (response) => {
        setLoading(false);
        if (response.status === 200) {
          fireEvents('register');
          return track(TrackEnum.CompleteRegistration).then(() => {
            if (response.headers.get('activate') === 'true') {
              router.push('/auth/activate');
            } else {
              router.push('/auth/login');
            }
          });
        } else {
          const message = await response.text();
          // Route the server error to the field it's actually about, so a
          // password-policy failure (e.g. breached password) doesn't highlight
          // the email field.
          form.setError(/password|breach/i.test(message) ? 'password' : 'email', {
            message,
          });
        }
      })
      .catch((e) => {
        form.setError('email', {
          message:
            'Unexpected error: ' +
            e.toString() +
            '. Please check your browser console.',
        });
      });
  };
  return (
    <FormProvider {...form}>
      <form className="flex-1 flex" onSubmit={form.handleSubmit(onSubmit)}>
        <div className="flex flex-col flex-1">
          <div>
            <h1 className="cursor-pointer text-start text-[40px] font-[700] tracking-[-0.04em] text-white">
              {t('sign_up', 'Sign Up')}
            </h1>
            <p className="mt-[8px] text-[15px] text-textColor/58">
              {t(
                'auth_register_subtitle',
                'Create your Postra workspace and plan content faster.'
              )}
            </p>
          </div>
          <div className="mb-[12px] mt-[28px] text-[12px] font-[600] uppercase tracking-[0.08em] text-textColor/55">
            {t('continue_with', 'Continue With')}
          </div>
          <div className="flex flex-col">
            {!isAfterProvider &&
              (!isGeneral ? (
                <GithubProvider />
              ) : (
                <div className="gap-[8px] flex">
                  {genericOauth && isGeneral ? (
                    <OauthProvider />
                  ) : (
                    <GoogleProvider />
                  )}
                </div>
              ))}
            {!isAfterProvider && (
              <div className="h-[20px] mb-[24px] mt-[24px] relative">
                <div className="absolute top-[50%] h-[1px] w-full -translate-y-[50%] bg-white/10" />
                <div
                  className={`absolute z-[1] justify-center items-center w-full start-0 -top-[4px] flex`}
                >
                  <div className="rounded-full border border-white/8 bg-[rgba(15,23,42,0.92)] px-[16px] py-[4px] text-[11px] font-[700] uppercase tracking-[0.08em] text-textColor/52">
                    {t('or', 'OR')}
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-[12px]">
              <div className="text-textColor">
                {!isAfterProvider && (
                  <>
                    <Input
                      label="Email"
                      translationKey="label_email"
                      {...form.register('email', {
                        onChange: () => form.clearErrors('email'),
                      })}
                      type="email"
                      placeholder={t('email_address', 'Email Address')}
                    />
                    <Input
                      label="Password"
                      translationKey="label_password"
                      {...form.register('password', {
                        onChange: () => form.clearErrors('password'),
                      })}
                      autoComplete="off"
                      type="password"
                      placeholder={t('label_password', 'Password')}
                    />
                    {passwordValue && (
                      <div className="-mt-[6px] mb-[14px] flex flex-col gap-[6px]">
                        <div className="flex gap-[4px]">
                          {[0, 1, 2, 3].map((i) => (
                            <div
                              key={i}
                              className="h-[4px] flex-1 rounded-full transition-colors"
                              style={{
                                backgroundColor:
                                  i < strength
                                    ? strengthMeta.color
                                    : 'rgba(255,255,255,0.1)',
                              }}
                            />
                          ))}
                        </div>
                        <span
                          className="text-[11px] font-[600]"
                          style={{ color: strengthMeta.color }}
                        >
                          {strengthMeta.label}
                        </span>
                      </div>
                    )}
                    <Input
                      label="Confirm Password"
                      translationKey="label_confirm_password"
                      {...form.register('confirmPassword', {
                        onChange: () => form.clearErrors('confirmPassword'),
                      })}
                      autoComplete="off"
                      type="password"
                      placeholder={t(
                        'label_confirm_password',
                        'Confirm Password'
                      )}
                    />
                  </>
                )}
                <Input
                  label="Company"
                  translationKey="label_company"
                  {...form.register('company')}
                  autoComplete="off"
                  type="text"
                  placeholder={t('label_company', 'Company')}
                />
              </div>
              <div className={clsx('rounded-[14px] border border-white/8 bg-white/[0.025] px-[14px] py-[12px] text-[12px] text-textColor/68')}>
                <div className="flex items-start gap-[10px]">
                  <Checkbox
                    name="termsAccepted"
                    className="shrink-0"
                    ariaLabel={t(
                      'accept_terms_aria',
                      'I accept the Terms of Service and Privacy Policy, and confirm that I am 18 or older'
                    )}
                  />
                  <div>
                    {t('i_accept_the', 'I accept the')}
                    &nbsp;
                    <a
                      href={`https://postra.co.uk/terms`}
                      className="underline underline-offset-4 hover:text-[#38bdf8]"
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                    >
                      {t('terms_of_service', 'Terms of Service')}
                    </a>
                    &nbsp;
                    {t('and', 'and')}&nbsp;
                    <a
                      href={`https://postra.co.uk/privacy`}
                      target="_blank"
                      rel="nofollow noopener noreferrer"
                      className="underline underline-offset-4 hover:text-[#38bdf8]"
                    >
                      {t('privacy_policy', 'Privacy Policy')}
                    </a>
                    ,&nbsp;
                    {t(
                      'and_confirm_18_or_older',
                      'and confirm that I am 18 or older'
                    )}
                  </div>
                </div>
                {!!form.formState.errors.termsAccepted && (
                  <div className="mt-[8px] text-[#f87171]">
                    {form.formState.errors.termsAccepted.message}
                  </div>
                )}
              </div>
              <div className="text-center mt-6">
                <div className="w-full flex">
                  <Button
                    type="submit"
                    className="flex-1 rounded-[12px] !h-[52px]"
                    loading={loading}
                  >
                    {t('create_account', 'Create Account')}
                  </Button>
                </div>
                <p className="mt-4 text-sm text-textColor/66">
                  {t('already_have_an_account', 'Already Have An Account?')}
                  &nbsp;
                  <Link
                    href="/auth/login"
                    className="underline underline-offset-4 cursor-pointer text-textColor hover:text-[#38bdf8]"
                  >
                    {t('sign_in', 'Sign In')}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
}
