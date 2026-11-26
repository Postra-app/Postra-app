// A small server set up the way the backend is, for the tracing specs. They
// run it in a Node process of its own: the instrumentations hook into Node's
// module loader, which Jest replaces with its own.
//
// Talks to the spec over the process channel: says `ready` with its port,
// answers `spans` with what the in-memory exporter holds and `shutdown` with
// how long the shutdown took.
import { initializeTracing, flushTracing, shutdownTracing, tracingStarted } from './initialize.tracing';

// What the spec passes in: where the other servers are and the values that
// must not show up in a span.
const config: {
  exporter?: 'memory';
  secrets?: Record<string, string>;
  platformUrl?: string;
  redisAddress?: string;
  closedAddress?: string;
} = JSON.parse(process.argv[2] || '{}');

const inMemory = config.exporter === 'memory';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const memory = inMemory ? new (require('@opentelemetry/sdk-trace').InMemorySpanExporter)() : undefined;
initializeTracing('backend', memory ? { exporter: memory } : {});

// After tracing, as in main.ts.
import 'reflect-metadata';
import { Body, Controller, Get, Module, Param, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { trace } from '@opentelemetry/api';

const secrets = config.secrets ?? {};
const platformUrl = config.platformUrl;
// Nothing listens there: the database client fails at once, its spans are still made.
const nowhere = config.closedAddress || '127.0.0.1:9';

const redis = new Redis(
  `redis://:${secrets.redisPassword}@${config.redisAddress || nowhere}`,
  {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  }
);
redis.on('error', (): undefined => undefined);

const prisma = new PrismaClient({
  datasources: {
    db: { url: `postgresql://user:${secrets.databasePassword}@${nowhere}/db?connect_timeout=1` },
  },
});

@Controller()
class FixtureController {
  @Post('posts/:id')
  async post(@Param('id') id: string, @Body() body: { content?: string }) {
    const answer = await fetch(
      `${platformUrl}/${secrets.pathKey}/media?access_token=${secrets.outgoingToken}&to=${secrets.email}`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secrets.outgoingBearer}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: secrets.outgoingBody }),
      }
    );
    await redis.set(`session:${secrets.email}`, secrets.redisValue).catch((): undefined => undefined);
    await prisma.$queryRaw`SELECT ${secrets.email}::text, ${secrets.sqlValue}::text`.catch(
      (): undefined => undefined
    );
    return { id, platform: await answer.json(), content: body?.content };
  }

  @Get('fails')
  fails() {
    throw new Error(
      `could not write to ${secrets.email} through https://user:${secrets.outgoingBearer}@mail.example/send?key=${secrets.queryToken}`
    );
  }

  @Get(['monitor/live', 'monitor/queue/:name', 'health/status', 'metrics', 'other'])
  ok() {
    return { status: 'success' };
  }
}

@Module({ controllers: [FixtureController] })
class FixtureModule {}

const loaded = (name: string) =>
  Object.keys(require.cache).some((file) => file.includes(`/node_modules/${name}/`));

const ready = (async () => {
  const app = await NestFactory.create(FixtureModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  process.send?.({
    type: 'ready',
    port: app.getHttpServer().address().port,
    started: tracingStarted(),
    sdkLoaded: loaded('@opentelemetry/sdk-node') || loaded('@opentelemetry/sdk-trace'),
    recording: trace.getTracer('fixture').startSpan('probe').isRecording(),
  });
  return app;
})();

process.on('message', async (message: { type: string; timeoutMs?: number }) => {
  if (message.type === 'spans') {
    await flushTracing();
    const spans = (memory?.getFinishedSpans() ?? []).map((span: any) => ({
      name: span.name,
      kind: span.kind,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId,
      scope: span.instrumentationScope.name,
      attributes: span.attributes,
      status: span.status,
      events: span.events.map((event: any) => ({ name: event.name, attributes: event.attributes })),
      resource: span.resource.attributes,
    }));
    memory?.reset();
    process.send?.({ type: 'spans', spans });
  }
  if (message.type === 'shutdown') {
    const startedAt = Date.now();
    await shutdownTracing(message.timeoutMs);
    process.send?.({ type: 'shutdown', ms: Date.now() - startedAt });
    redis.disconnect();
    await (await ready).close();
    process.exit(0);
  }
});
