const redis = { ping: jest.fn() };
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redis,
}));

import { HttpException } from '@nestjs/common';
import { MonitorController } from './monitor.controller';

/**
 * E2E-01-07 — the deploy gate and Upptime read this route, and it answered
 * "healthy" without checking anything.
 */
const controllerWith = (query: () => Promise<unknown>) =>
  new MonitorController({ $queryRaw: jest.fn(query) } as any);

const answer = async (c: MonitorController) => {
  try {
    return { status: 200, body: await c.getMessagesGroup('main') };
  } catch (e) {
    if (!(e instanceof HttpException)) throw e;
    return { status: e.getStatus(), body: e.getResponse() as any };
  }
};

describe('GET /monitor/queue/:name', () => {
  beforeEach(() => redis.ping.mockReset());

  it('is healthy only when the database and Redis both answer', async () => {
    redis.ping.mockResolvedValue('PONG');
    const res = await answer(controllerWith(async () => [{ '?column?': 1 }]));
    expect(res.status).toBe(200);
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'ok' });
  });

  it('answers 503 when the database is down', async () => {
    redis.ping.mockResolvedValue('PONG');
    const res = await answer(
      controllerWith(async () => {
        throw new Error('connection refused');
      })
    );
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: 'down', redis: 'ok' });
  });

  it('answers 503 instead of hanging when Redis never replies', async () => {
    jest.useFakeTimers();
    redis.ping.mockReturnValue(new Promise(() => {}));
    const pending = answer(controllerWith(async () => [{}]));
    await jest.advanceTimersByTimeAsync(3000);
    const res = await pending;
    jest.useRealTimers();
    expect(res.status).toBe(503);
    expect(res.body.checks).toEqual({ database: 'ok', redis: 'down' });
  });
});
