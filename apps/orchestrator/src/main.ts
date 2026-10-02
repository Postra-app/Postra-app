import { initializeSentry } from '@gitroom/nestjs-libraries/sentry/initialize.sentry';
initializeSentry('orchestrator', true);
import 'source-map-support/register';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
dayjs.extend(utc);

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '@gitroom/orchestrator/app.module';
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

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const port = process.env.ORCHESTRATOR_PORT || 3002;
  await app.listen(port);
  Logger.log(`Orchestrator health check listening on port ${port}`, 'Bootstrap');
}


bootstrap();
