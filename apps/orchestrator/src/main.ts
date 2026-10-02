// Boot stages with time and RSS, as in the backend (B0, the start that hangs
// before Nest logs anything). writeSync: a hung loop never flushes async writes.
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
initializeSentry('orchestrator', true);
bootStep('sentry initialised');
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/orchestrator/app.module';
bootStep('app module imported');
import * as dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { Runtime } from '@temporalio/worker';

// Temporal SDK (worker) Prometheus metrics — workflow success/failure, activity
// retries, schedule-to-start latency, task-queue backlog. This is the core
// product signal ("are posts going out, on time?"). Must run before the worker
// is created; nestjs-temporal-core does not install a Runtime itself, so this
// one wins (no "already installed" clash). Bound to 0.0.0.0 = docker-net only,
// not published to host/ALB; Alloy scrapes app:9464. See observability.md 1.2.
Runtime.install({
  telemetryOptions: {
    metrics: {
      prometheus: { bindAddress: '0.0.0.0:9464' },
    },
  },
});
bootStep('temporal runtime installed');

async function bootstrap() {
  bootStep('nest create');
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  Logger.log(`Orchestrator health check listening on port ${port}`, 'Bootstrap');
}


bootstrap();
