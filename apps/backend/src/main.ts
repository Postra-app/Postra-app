// Boot stages with time and RSS, for the start that hangs before Nest's first
// log line (e2e/backend/01-boot-hang.md, B0): the last [boot] line before a
// hang names the step. writeSync because a hung event loop never flushes an
// async write to the pm2 pipe.
import { writeSync } from 'fs';
const bootStep = (step: string) =>
  writeSync(
    1,
    `[boot] ${new Date().toISOString()} ${step} rss=${Math.round(
      process.memoryUsage().rss / 1e6
    )}MB\n`
  );
bootStep('start');
import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
bootStep('sentry imported');
initializeSentry('backend', true);
bootStep('sentry initialised');
import compression from 'compression';

import { loadSwagger } from '@gitroom/helpers/swagger/load.swagger';
import { json } from 'express';
import { Runtime } from '@temporalio/worker';
bootStep('temporal worker imported');
Runtime.install({ shutdownSignals: [] });
bootStep('temporal runtime installed');

process.env.TZ = 'UTC';

import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
bootStep('app module imported');

import {
  PermissionDeniedExceptionFilter,
  SubscriptionExceptionFilter,
} from '@gitroom/backend/services/auth/permissions/subscription.exception';
import { PostValidationExceptionFilter } from '@gitroom/backend/api/routes/posts.validation.exception';
import { HttpExceptionFilter } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ConfigurationChecker } from '@gitroom/helpers/configuration/configuration.checker';
import { startMcp } from '@gitroom/nestjs-libraries/chat/start.mcp';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { startMetricsServer } from './metrics/metrics';

async function start() {
  bootStep('nest create');
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    cors: {
      ...(!process.env.NOT_SECURED ? { credentials: true } : {}),
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'auth',
        'showorg',
        'impersonate',
        'x-copilotkit-runtime-client-gql-version',
      ],
      exposedHeaders: [
        'reload',
        'onboarding',
        'activate',
        'x-copilotkit-runtime-client-gql-version',
        ...(process.env.NOT_SECURED ? ['auth', 'showorg', 'impersonate'] : []),
      ],
      origin: [
        process.env.FRONTEND_URL,
        // MCP inspector origin — dev only, never in the prod allow-list.
        ...(process.env.NOT_SECURED ? ['http://localhost:6274'] : []),
        ...(process.env.MAIN_URL ? [process.env.MAIN_URL] : []),
      ],
    },
  });

  try {
    // startMcp boots the AI copilot (Mastra + MCP server). It must never take
    // the whole backend down: if it throws, the copilot should be unavailable,
    // not the entire app. (A Mastra Postgres bug crash-looped bootstrap this way
    // twice — see the mastra_ai_spans column guard in MastraService.)
    await startMcp(app);
  } catch (err) {
    new Logger('startMcp').error(
      'AI copilot / MCP failed to initialise — starting the backend without it.',
      err instanceof Error ? err.stack : String(err)
    );
  }

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      // AE7: strip body/query properties that carry no validation decorator.
      // Without this, one future `data: {...body}` spread in a service is an
      // instant mass-assignment hole. Every DTO field the app actually
      // consumes must therefore be decorated — use @Allow() for opaque
      // passthrough objects (video params, integration function data).
      whitelist: true,
    })
  );

  app.use(
    ['/copilot/{*splat}', '/posts', '/media/{*splat}', '/user/problem-report'],
    (req: any, res: any, next: any) => {
      // Studio routes under /media (refine-design, :id/canvas, :id/design-spec)
      // carry canvas screenshots and JSON that exceed Express's default ~100kb
      // limit. Multipart /upload-simple is
      // untouched — json() skips non-application/json bodies. 25mb bounds a
      // full-canvas PNG data-URL with headroom while keeping the worst case
      // (concurrent large bodies x 3 pm2 workers on a 3.7GiB box) survivable.
      json({ limit: '25mb' })(req, res, next);
    }
  );

  // The backend is a JSON API; the only HTML it serves is Swagger UI (/docs),
  // so the CSP just needs to cover that: self-hosted bundle + the inline
  // styles swagger-ui injects. COEP stays off — it would demand CORP headers
  // on every cross-origin resource (OAuth popups, provider media).
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    })
  );
  app.use(cookieParser());
  app.use(compression());
  app.useGlobalFilters(
    new SubscriptionExceptionFilter(),
    new PermissionDeniedExceptionFilter()
  );
  app.useGlobalFilters(new PostValidationExceptionFilter());
  app.useGlobalFilters(new HttpExceptionFilter());

  // Swagger UI is dev-only (NOT_SECURED is never set in prod): the full
  // endpoint inventory at /docs is free recon for an attacker, and the API
  // needs no public docs.
  if (process.env.NOT_SECURED) {
    loadSwagger(app);
  }

  const port = process.env.PORT || 3000;

  try {
    bootStep('listen');
    await app.listen(port);
    bootStep('listening');
    Logger.log(`Backend started successfully on port ${port}`, 'Bootstrap');

    // Prometheus /metrics on a dedicated internal port (not behind the app's
    // throttle/auth guards). Internal docker-net only; Alloy scrapes it.
    startMetricsServer();

    // One-off: encrypt integration tokens still stored as plaintext (A1 backfill).
    // Fire-and-forget so it never delays or breaks boot; guarded to run once.
    runTokenBackfill(app).catch((e) =>
      Logger.warn(
        `Token backfill failed: ${e instanceof Error ? e.message : e}`
      )
    );

    checkConfiguration(); // Do this last, so that users will see obvious issues at the end of the startup log without having to scroll up.

    Logger.log(`🚀 Backend is running on: http://localhost:${port}`);
  } catch (e) {
    Logger.error(`Backend failed to start on port ${port}`, e);
  }
}

function checkConfiguration() {
  const checker = new ConfigurationChecker();
  checker.readEnvFromProcess();
  checker.check();

  if (checker.hasIssues()) {
    for (const issue of checker.getIssues()) {
      Logger.warn(issue, 'Configuration issue');
    }

    Logger.warn('Configuration issues found: ' + checker.getIssuesCount());
  } else {
    Logger.log('Configuration check completed without any issues');
  }
}

async function runTokenBackfill(app: Awaited<ReturnType<typeof NestFactory.create>>) {
  // Encrypt any Integration tokens still stored as plaintext. Idempotent and
  // guarded by a Redis flag so it runs once across restarts; wrapped so a
  // failure (e.g. Redis blip) never affects backend boot.
  try {
    if (await ioRedis.get('token_encryption_backfill_v1')) {
      return;
    }
    const result = await app
      .get(IntegrationService)
      .backfillTokenEncryption();
    await ioRedis.set('token_encryption_backfill_v1', '1');
    Logger.log(
      `Token encryption backfill: ${result.updated}/${result.total} integrations encrypted`
    );
  } catch (e) {
    Logger.warn(
      `Token encryption backfill skipped: ${
        e instanceof Error ? e.message : e
      }`
    );
  }
}

start();
