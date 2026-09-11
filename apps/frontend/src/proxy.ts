import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import acceptLanguage from 'accept-language';
import {
  cookieName,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';
acceptLanguage.languages(languages);

// This function can be marked `async` if using `await` inside
export async function proxy(request: NextRequest) {
  const nextUrl = request.nextUrl;
  // ?loggedAuth= (mobile-WebView bridge) is honored only on /provider/ pages
  // — see custom.fetch.func.ts for the rationale.
  const authCookie =
    request.cookies.get('auth') ||
    request.headers.get('auth') ||
    (nextUrl.pathname.startsWith('/provider/')
      ? nextUrl.searchParams.get('loggedAuth')
      : null);
  const lng = request.cookies.has(cookieName)
    ? acceptLanguage.get(request.cookies.get(cookieName).value)
    : acceptLanguage.get(
        request.headers.get('Accept-Language') ||
          request.headers.get('accept-language')
      );

  const requestHeaders = new Headers(request.headers);
  if (lng) {
    requestHeaders.set(headerName, lng);
  }

  const topResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  if (lng) {
    topResponse.headers.set(cookieName, lng);
  }

  if (nextUrl.pathname.startsWith('/modal/') && !authCookie) {
    return NextResponse.redirect(new URL(`/auth/login-required`, nextUrl.href));
  }

  if (
    nextUrl.pathname.startsWith('/uploads/') ||
    nextUrl.pathname.startsWith('/p/') ||
    nextUrl.pathname.startsWith('/provider/') ||
    // Invite links are opened by the customer's client, who has no account here.
    nextUrl.pathname.startsWith('/connect/') ||
    nextUrl.pathname.startsWith('/icons/')
  ) {
    return topResponse;
  }

  if (
    nextUrl.pathname.startsWith('/integrations/social/') &&
    nextUrl.href.indexOf('state=login') === -1
  ) {
    return topResponse;
  }

  // If the URL is logout, delete the cookie and redirect to login
  if (nextUrl.href.indexOf('/auth/logout') > -1) {
    const response = NextResponse.redirect(
      new URL('/auth/login', nextUrl.href)
    );
    response.cookies.set('auth', '', {
      path: '/',
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          }
        : {}),
      maxAge: -1,
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    });
    return response;
  }

  if (
    nextUrl.pathname.startsWith('/auth/register') &&
    process.env.DISABLE_REGISTRATION === 'true'
  ) {
    return NextResponse.redirect(new URL('/auth/login', nextUrl.href));
  }

  const org = nextUrl.searchParams.get('org');
  const url = new URL(nextUrl).search;
  if (!nextUrl.pathname.startsWith('/auth') && !authCookie) {
    const providers = ['google', 'settings'];
    const findIndex = providers.find((p) => nextUrl.href.indexOf(p) > -1);
    const additional = !findIndex
      ? ''
      : (url.indexOf('?') > -1 ? '&' : '?') +
        `provider=${(findIndex === 'settings'
          ? process.env.POSTRA_GENERIC_OAUTH
            ? 'generic'
            : 'github'
          : findIndex
        ).toUpperCase()}`;
    return NextResponse.redirect(
      new URL(`/auth${url}${additional}`, nextUrl.href)
    );
  }

  /**
   * /admin, refused at the edge.
   *
   * The panel was gated by a client component, which is enough to keep the
   * data in: every /admin/* endpoint asserts the flag server-side, and the
   * layout renders nothing until /user/self resolves, so there was no leak and
   * no flash of content. What did leak was the map — any signed-in account got
   * the route skeleton and the panel's JS chunks, and with them every admin
   * endpoint path, the Sentry, Grafana and CloudWatch identifiers and the
   * dashboard names (E2E-09-10). Reconnaissance, not access, but free.
   *
   * One backend call, on this prefix only.
   *
   * A failure here must not log anybody out. The catch below this turns a
   * failed internalFetch into a redirect to /auth/logout, which for a wrong
   * answer on this check would throw the admin out of their own session — the
   * same shape as the 403-that-became-a-401 in auth.middleware. So this has
   * its own try/catch and falls through to the client gate, which is exactly
   * where we were before.
   */
  if (nextUrl.pathname.startsWith('/admin')) {
    try {
      const self = await internalFetch('/user/self');
      if (self.ok) {
        const me = await self.json();
        if (!me?.isSuperAdmin || me?.impersonate) {
          // Same landing page the root redirect uses, so this does not become
          // a second opinion about where "home" is.
          return NextResponse.redirect(
            new URL(
              !!process.env.IS_GENERAL ? '/launches' : '/analytics',
              nextUrl.href
            )
          );
        }
      }
    } catch (err) {
      console.error('[Postra:proxy] /admin check failed, letting the client gate decide', err);
    }
  }

  // If the url is /auth and the cookie exists, redirect to / — EXCEPT the
  // email-token pages (password reset + account activation). Those links are
  // opened from an inbox and must work even when another session is already
  // live in the browser; otherwise this blanket rule bounces the user straight
  // into whatever account that cookie belongs to. The reset/activate token is
  // bound server-side to its own user id, so a stray cookie can't retarget it.
  const isEmailTokenPage =
    nextUrl.pathname.startsWith('/auth/forgot') ||
    nextUrl.pathname.startsWith('/auth/activate');
  if (
    nextUrl.pathname.startsWith('/auth') &&
    !isEmailTokenPage &&
    authCookie
  ) {
    return NextResponse.redirect(new URL(`/${url}`, nextUrl.href));
  }
  if (nextUrl.pathname.startsWith('/auth') && !authCookie) {
    if (org) {
      const redirect = NextResponse.redirect(new URL(`/`, nextUrl.href));
      redirect.cookies.set('org', org, {
        ...(!process.env.NOT_SECURED
          ? {
              path: '/',
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
              domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
            }
          : {}),
        expires: new Date(Date.now() + 15 * 60 * 1000),
      });
      return redirect;
    }
    return topResponse;
  }
  try {
    if (org) {
      const { id } = await (
        await internalFetch('/user/join-org', {
          body: JSON.stringify({
            org,
          }),
          method: 'POST',
        })
      ).json();
      const redirect = NextResponse.redirect(
        new URL(`/?added=true`, nextUrl.href)
      );
      if (id) {
        redirect.cookies.set('showorg', id, {
          ...(!process.env.NOT_SECURED
            ? {
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'lax',
                domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
              }
            : {}),
          expires: new Date(Date.now() + 15 * 60 * 1000),
        });
      }
      return redirect;
    }
    if (nextUrl.pathname === '/') {
      return NextResponse.redirect(
        new URL(
          !!process.env.IS_GENERAL ? '/launches' : `/analytics`,
          nextUrl.href
        )
      );
    }

    return topResponse;
  } catch (err) {
    console.error('[Postra:proxy] request failed, redirecting to logout', err);
    return NextResponse.redirect(new URL('/auth/logout', nextUrl.href));
  }
}

// See "Matching Paths" below to learn more
export const config = {
  matcher: '/((?!api/|_next/|_static/|_vercel|[\\w-]+\\.\\w+).*)',
};