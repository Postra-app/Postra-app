export const dynamic = 'force-dynamic';
import '../global.scss';
import 'react-tooltip/dist/react-tooltip.css';
import '@copilotkit/react-ui/styles.css';
import LayoutContext from '@gitroom/frontend/components/layout/layout.context';
import { ReactNode } from 'react';
import { GeistSans } from 'geist/font/sans';
import clsx from 'clsx';
import { VariableContextComponent } from '@gitroom/react/helpers/variable.context';
import UtmSaver from '@gitroom/helpers/utils/utm.saver';
import { requestLanguage } from '@gitroom/frontend/components/layout/request.language';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const language = await requestLanguage();
  return (
    <html lang={language}>
      <head>
        <link rel="icon" href="/postra-icon.webp" type="image/webp" />
      </head>
      <body
        className={clsx(GeistSans.className, 'dark text-primary !bg-primary')}
      >
        <VariableContextComponent
          language={language}
          storageProvider={
            process.env.STORAGE_PROVIDER! as 'local' | 'cloudflare' | 's3'
          }
          stripeClient=""
          environment={process.env.NODE_ENV!}
          backendUrl={process.env.NEXT_PUBLIC_BACKEND_URL!}
          plontoKey={process.env.NEXT_PUBLIC_POLOTNO!}
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
          dub={false}
          facebookPixel={process.env.NEXT_PUBLIC_FACEBOOK_PIXEL!}
          telegramBotName={process.env.TELEGRAM_BOT_NAME!}
          isSecured={!process.env.NOT_SECURED}
          disableImageCompression={!!process.env.DISABLE_IMAGE_COMPRESSION}
          disableXAnalytics={!!process.env.DISABLE_X_ANALYTICS}
          sentryDsn={process.env.NEXT_PUBLIC_SENTRY_DSN!}
          extensionId={process.env.EXTENSION_ID || ''}
          transloadit={
            process.env.TRANSLOADIT_AUTH && process.env.TRANSLOADIT_TEMPLATE
              ? [
                  process.env.TRANSLOADIT_AUTH!,
                  process.env.TRANSLOADIT_TEMPLATE!,
                ]
              : []
          }
        >
          <LayoutContext>
            <UtmSaver />
            {children}
          </LayoutContext>
        </VariableContextComponent>
      </body>
    </html>
  );
}
