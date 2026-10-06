import { SentryComponent } from '@gitroom/frontend/components/layout/sentry.component';
import type { Viewport } from 'next';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0e1a',
};
import '../global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import '@copilotkit/react-ui/styles.css';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import clsx from 'clsx';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import { PHProvider } from '@gitroom/react/helpers/posthog';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { DubAnalytics } from '@gitroom/frontend/components/layout/dubAnalytics';
import { FacebookComponent } from '@gitroom/frontend/components/layout/facebook.component';
import { GoogleTagManagerComponent } from '@gitroom/frontend/components/layout/gtm.component';
import { cookies, headers } from 'next/headers';
import {
  cookieName,
  fallbackLng,
  headerName,
} from '@gitroom/react/translation/i18n.config';
import { HtmlComponent } from '@gitroom/frontend/components/layout/html.component';
import Script from 'next/script';
import { ChangeDirClient } from '@gitroom/frontend/components/new-layout/change.dir.client';
import { GlobalErrorLogger } from '@gitroom/frontend/components/layout/global-error-logger.client';
import { SwrProvider } from '@gitroom/frontend/components/layout/swr.provider';
import { ConnectionStatus } from '@gitroom/frontend/components/layout/connection.status';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  // Explicit cookie choice first; else the device language proxy.ts resolved from
  // Accept-Language (so a first-time visitor renders in their language, no PL flash).
  const language =
    cookieStore.get(cookieName)?.value ||
    (await headers()).get(headerName) ||
    fallbackLng;
  // Plausible (no cookies, no personal data): on only where the site's own
  // script id is set, e.g. pa-xxxx for app.postra.pl. It used to follow the
  // Stripe key and report to the postra.pl site (E2E-02-13).
  const plausibleScript = process.env.PLAUSIBLE_SCRIPT_ID;
  return (
    // lang: screen readers pick their voice from it, and it was missing.
    <html lang={language}>
      <head>
        <link rel="icon" href="/postra-icon.webp" type="image/webp" />
        {!!process.env.DATAFAST_WEBSITE_ID && (
          <Script
            data-website-id={process.env.DATAFAST_WEBSITE_ID}
            data-domain="postra.pl"
            src="https://datafa.st/js/script.js"
            strategy="afterInteractive"
          />
        )}
        {!!plausibleScript && (
          <>
            <Script
              src={`https://plausible.io/js/${plausibleScript}.js`}
              strategy="afterInteractive"
            />
            <Script id="plausible-init" strategy="afterInteractive">
              {`window.plausible=window.plausible||function(){(plausible.q=plausible.q||[]).push(arguments)},plausible.init=plausible.init||function(i){plausible.o=i||{}};plausible.init()`}
            </Script>
          </>
        )}
      </head>
      <ChangeDirClient />
      <body className={clsx(GeistSans.className, 'text-primary !bg-primary')}>
        <VariableContextComponent
          storageProvider={
            process.env.STORAGE_PROVIDER! as 'local' | 'cloudflare' | 's3'
          }
          environment={process.env.NODE_ENV!}
          backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL!}
          plontoKey={process.env.NEXT_PUBLIC_POLOTNO!}
          stripeClient={process.env.STRIPE_PUBLISHABLE_KEY!}
          billingEnabled={!!process.env.STRIPE_PUBLISHABLE_KEY}
          discordUrl={process.env.NEXT_PUBLIC_DISCORD_SUPPORT!}
          frontEndUrl={process.env.FRONTEND_URL!}
          isGeneral={!!process.env.IS_GENERAL}
          genericOauth={process.env.POSTRA_GENERIC_OAUTH === 'true'}
          oauthLogoUrl={process.env.NEXT_PUBLIC_POSTRA_OAUTH_LOGO_URL!}
          oauthDisplayName={process.env.NEXT_PUBLIC_POSTRA_OAUTH_DISPLAY_NAME!}
          uploadDirectory={process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY!}
          cloudflareUrl={process.env.CLOUDFLARE_BUCKET_URL || ''}
          mainUrl={process.env.MAIN_URL || ''}
          mcpUrl={process.env.MCP_URL}
          dub={!!process.env.STRIPE_PUBLISHABLE_KEY}
          facebookPixel={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL!}
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
          isSecured={!process.env.NOT_SECURED}
          disableImageCompression={!!process.env.DISABLE_IMAGE_COMPRESSION}
          disableXAnalytics={!!process.env.DISABLE_X_ANALYTICS}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN!}
          extensionId={process.env.EXTENSION_ID || ''}
          disableRegistration={process.env.DISABLE_REGISTRATION === 'true'}
          googleAdsId={process.env.NEXT_PUBLIC_GTM_ID}
          googleAdsTrialTracking={process.env.NEXT_PUBLIC_TRACKING_TRIAL}
          language={language}
          transloadit={
            process.env.TRANSLOADIT_AUTH && process.env.TRANSLOADIT_TEMPLATE
              ? [
                  process.env.TRANSLOADIT_AUTH!,
                  process.env.TRANSLOADIT_TEMPLATE!,
                ]
              : []
          }
        >
          <SentryComponent>
            {/*<SetTimezone />*/}
            <GlobalErrorLogger />
            <HtmlComponent />
            <DubAnalytics />
            <FacebookComponent />
            <GoogleTagManagerComponent gtmId={process.env.NEXT_PUBLIC_GTM_ID} />
            <PHProvider
              phkey={process.env.NEXT_PUBLIC_POSTHOG_KEY}
              host={process.env.NEXT_PUBLIC_POSTHOG_HOST}
            >
              <LayoutContext>
                <UtmSaver />
                <ConnectionStatus />
                <SwrProvider>{children}</SwrProvider>
              </LayoutContext>
            </PHProvider>
          </SentryComponent>
        </VariableContextComponent>
      </body>
    </html>
  );
}
