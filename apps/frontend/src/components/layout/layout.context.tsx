'use client';

import { ReactNode, useCallback, useRef } from 'react';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
export default function LayoutContext(params: { children: ReactNode }) {
  if (params?.children) {
    // eslint-disable-next-line react/no-children-prop
    return <LayoutContextInner children={params.children} />;
  }
  return <></>;
}
export function setCookie(cname: string, cvalue: string, exdays: number) {
  if (typeof document === 'undefined') {
    return;
  }
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = cname + '=' + cvalue + ';' + expires + ';path=/';
}
function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const toaster = useToaster();
  const t = useT();
  // parallel requests can all hit 429 at once — show the toast at most once per 5s
  const last429 = useRef(0);
  // ...and during a backend restart every request on the page 502s together
  const last5xx = useRef(0);
  const afterRequest = useCallback(
    async (url: string, options: RequestInit, response: Response) => {
      if (
        typeof window !== 'undefined' &&
        (window.location.href.includes('/p/') ||
          window.location.pathname.startsWith('/provider/'))
      ) {
        return true;
      }
      const headerAuth =
        response?.headers?.get('auth') || response?.headers?.get('Auth');
      const showOrg =
        response?.headers?.get('showorg') || response?.headers?.get('Showorg');
      const impersonate =
        response?.headers?.get('impersonate') ||
        response?.headers?.get('Impersonate');
      const logout =
        response?.headers?.get('logout') || response?.headers?.get('Logout');
      // JS-written cookies are only for NOT_SECURED (local dev): in prod the
      // proxy sets httpOnly cookies and a JS-readable copy would hand the
      // session to any XSS. The backend only exposes these headers when
      // NOT_SECURED — this gate is defense-in-depth.
      if (headerAuth && !isSecured) {
        setCookie('auth', headerAuth, 365);
      }
      if (showOrg && !isSecured) {
        setCookie('showorg', showOrg, 365);
      }
      if (impersonate && !isSecured) {
        setCookie('impersonate', impersonate, 365);
      }
      if (logout && !isSecured) {
        setCookie('auth', '', -10);
        setCookie('showorg', '', -10);
        setCookie('impersonate', '', -10);
        window.location.href = '/';
        return true;
      }
      const reloadOrOnboarding =
        response?.headers?.get('reload') ||
        response?.headers?.get('onboarding');
      if (reloadOrOnboarding) {
        const getAndClear = returnUrl.getAndClear();
        if (getAndClear) {
          window.location.href = getAndClear;
          return true;
        }
      }
      if (response?.headers?.get('onboarding')) {
        window.location.href = isGeneral
          ? '/launches?onboarding=true'
          : '/analytics?onboarding=true';
        return true;
      }

      if (response?.headers?.get('reload')) {
        window.location.reload();
        return true;
      }

      if (response.status === 401 || response?.headers?.get('logout')) {
        if (!isSecured) {
          setCookie('auth', '', -10);
          setCookie('showorg', '', -10);
          setCookie('impersonate', '', -10);
        }
        window.location.href = '/';
        // false -> FetchHandledError: we are navigating away, so the caller
        // must unwind rather than .json() the 401 body mid-redirect.
        return false;
      }
      if (response.status === 406) {
        if (
          await deleteDialog(
            'You are currently on a trial. To use this feature, you need to end it.',
            'End the trial and charge now',
            'Trial'
          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      if (response.status === 402) {
        if (
          await deleteDialog(
            // clone(): on Cancel the caller still reads this response, and
            // a consumed body threw "body already used"; a non-JSON 402 must
            // not throw either (upstream d727ac0b, 971aa369).
            (
              await response
                .clone()
                .json()
                .catch(() => ({}))
            ).message,
            'Go to billing',
            'Payment required'
          )
        ) {
          window.open('/billing', '_blank');
          return false;
        }
        return true;
      }

      // Authority, not entitlement: the member's role is too low. No billing
      // dialog — paying changes nothing here, only an admin granting the role
      // does. (Before the backend split these, this arrived as a 402 with no
      // message and opened an empty "Go to billing" dialog.)
      if (response.status === 403) {
        const body = await response.json().catch(() => null);
        toaster.show(
          body?.message ||
            t(
              'permission_denied',
              'You do not have permission to do this. Ask an admin of this organization to give you the required role.'
            ),
          'warning'
        );
        // false -> FetchHandledError, so the caller unwinds its loading state
        // instead of parsing a body it cannot use.
        return false;
      }

      if (response.status === 429) {
        if (Date.now() - last429.current > 5000) {
          last429.current = Date.now();
          toaster.show(
            t(
              'too_many_requests',
              'Too many requests — please wait a moment and try again.'
            ),
            'warning'
          );
        }
        // false -> FetchHandledError: callers must not .json() a 429 body and
        // render garbage / throw into the error boundary.
        return false;
      }

      // Same reasoning as 429, for the case that actually bit us: while the
      // backend restarts (every deploy) the ALB answers 5xx with an HTML error
      // page. `fetch` resolves — it is not a network failure — so the ~40
      // callers written as `await (await fetch(x)).json()` parse HTML as JSON.
      // In Safari that rejects with an opaque DOMException ("The string did not
      // match the expected pattern."), which Sentry reports as a crash while
      // the user sees nothing at all: clicking "Add channel" during a deploy
      // simply did nothing. Tell them why, and unwind.
      if (response.status >= 500) {
        // A 503 with a JSON message is the backend naming the cause (OpenAI
        // down: "AI is unavailable right now…"); any other 5xx stays generic.
        const named =
          response.status === 503 &&
          response.headers.get('content-type')?.includes('application/json')
            ? (await response.json().catch(() => null))?.message
            : undefined;
        if (Date.now() - last5xx.current > 5000) {
          last5xx.current = Date.now();
          toaster.show(
            typeof named === 'string'
              ? named
              : t(
                  'server_unavailable_try_again',
                  'The server is temporarily unavailable — please try again in a moment.'
                ),
            'warning'
          );
        }
        return false;
      }
      return true;
    },
    []
  );
  return (
    <FetchWrapperComponent baseUrl={backendUrl} afterRequest={afterRequest}>
      {params?.children || <></>}
    </FetchWrapperComponent>
  );
}
