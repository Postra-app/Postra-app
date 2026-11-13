'use client';

import { useForm, SubmitHandler, FormProvider } from 'react-hook-form';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import Link from 'next/link';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Input } from '@gitroom/react/form/input';
import { useMemo, useState } from 'react';
import { classValidatorResolver } from '@hookform/resolvers/class-validator';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { undeliverableText } from '@gitroom/frontend/components/auth/undeliverable.text';
import { useVariables } from '@gitroom/react/helpers/variable.context';
type Inputs = {
  email: string;
};
// The provider an account signs in with, as the login page names it.
const providerName = (provider?: string) =>
  provider === 'GOOGLE'
    ? 'Google'
    : provider === 'GITHUB'
    ? 'GitHub'
    : provider
    ? provider.charAt(0) + provider.slice(1).toLowerCase()
    : 'Google';
export function Forgot() {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState(false);
  const [problem, setProblem] = useState<{
    reason: 'no_account' | 'provider';
    provider?: string;
  } | null>(null);
  const { disableRegistration } = useVariables();
  const resolver = useMemo(() => {
    return classValidatorResolver(ForgotPasswordDto);
  }, []);
  const form = useForm<Inputs>({
    resolver,
  });
  const fetchData = useFetch();
  const onSubmit: SubmitHandler<Inputs> = async (data) => {
    setLoading(true);
    setProblem(null);
    try {
      const response = await fetchData('/auth/forgot', {
        method: 'POST',
        body: JSON.stringify({
          ...data,
          provider: 'LOCAL',
        }),
      });
      if (!response.ok) {
        form.setError('email', {
          message:
            response.status === 429
              ? t(
                  'forgot_too_many_attempts',
                  'Too many attempts - please wait a few minutes and try again.'
                )
              : (await readResponseError(response)) ||
                t(
                  'forgot_password_failed',
                  'Could not send the reset email. Please try again.'
                ),
        });
        return;
      }
      // The answer says what happened: sent, no account, an account that
      // signs in with Google (or another provider), or a mail that failed.
      const result = (await response.json().catch(() => ({}))) as {
        forgot?: boolean;
        reason?: string;
        provider?: string;
      };
      if (result.forgot) {
        setState(true);
        return;
      }
      if (result.reason === 'no_account' || result.reason === 'provider') {
        setProblem({ reason: result.reason, provider: result.provider });
        return;
      }
      // The mail server drops mail to this address.
      if (result.reason === 'undeliverable') {
        form.setError('email', { message: undeliverableText(t) });
        return;
      }
      form.setError('email', {
        message: t(
          'forgot_password_failed',
          'Could not send the reset email. Please try again.'
        ),
      });
    } catch (e) {
      console.error('[Postra:auth] forgot-password failed', e);
      form.setError('email', {
        message: t(
          'forgot_password_failed',
          'Could not send the reset email. Please try again.'
        ),
      });
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex flex-1 flex-col">
      <FormProvider {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <div>
            <h1 className="mb-4 cursor-pointer text-start text-[40px] font-[700] tracking-[-0.04em] text-white">
              {t('forgot_password_1', 'Forgot Password')}
            </h1>
            <p className="mb-6 text-[15px] text-textColor/58">
              {t(
                'forgot_password_subtitle',
                'We will send you a secure link to reset your password.'
              )}
            </p>
          </div>
          {!state ? (
            <>
              <div className="space-y-4 text-textColor">
                <Input
                  label="Email"
                  translationKey="label_email"
                  {...form.register('email')}
                  type="email"
                  autoComplete="email"
                  placeholder={t('email_address', 'Email Address')}
                />
              </div>
              {problem && (
                <div
                  data-testid="forgot-problem"
                  className="mt-4 rounded-[16px] border border-white/8 bg-white/[0.03] p-[16px] text-start text-[14px] text-textColor/78"
                >
                  {problem.reason === 'no_account' ? (
                    <>
                      {t(
                        'forgot_no_account',
                        'There is no Postra account with this email address.'
                      )}
                      {!disableRegistration && (
                        <>
                          {' '}
                          <Link
                            href="/auth/register"
                            className="underline underline-offset-4 hover:text-[#38bdf8]"
                          >
                            {t('forgot_create_account', 'Create an account')}
                          </Link>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {t(
                        'forgot_provider_account',
                        'This account signs in with {{provider}}, so it has no Postra password. Go back and use Continue with {{provider}}.',
                        { provider: providerName(problem.provider) }
                      )}{' '}
                      <Link
                        href="/auth/login"
                        className="underline underline-offset-4 hover:text-[#38bdf8]"
                      >
                        {t('go_back_to_login', 'Go back to login')}
                      </Link>
                    </>
                  )}
                </div>
              )}
              <div className="text-center mt-6">
                <div className="w-full flex">
                  <Button
                    type="submit"
                    className="flex-1 !h-[52px] !rounded-[12px]"
                    loading={loading}
                  >
                    {t(
                      'send_password_reset_email',
                      'Send Password Reset Email'
                    )}
                  </Button>
                </div>
                <p className="mt-4 text-sm text-textColor/66">
                  <Link
                    href="/auth/login"
                    className="underline underline-offset-4 cursor-pointer hover:text-[#38bdf8]"
                  >
                    {t('go_back_to_login', 'Go back to login')}
                  </Link>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mt-6 rounded-[16px] border border-white/8 bg-white/[0.03] p-[16px] text-start text-textColor/78">
                {t(
                  'we_have_send_you_an_email_with_a_link_to_reset_your_password',
                  'We have sent you an email with a link to reset your password.'
                )}
              </div>
              <p className="mt-4 text-sm text-textColor/66">
                <Link
                  href="/auth/login"
                  className="underline underline-offset-4 cursor-pointer hover:text-[#38bdf8]"
                >
                  {t('go_back_to_login', 'Go back to login')}
                </Link>
              </p>
            </>
          )}
        </form>
      </FormProvider>
    </div>
  );
}
