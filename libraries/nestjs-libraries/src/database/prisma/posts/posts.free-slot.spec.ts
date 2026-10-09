// Same module stubs as posts.analytics-days.spec.ts.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn() },
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

/**
 * "Next free slot" (composer, Auto Post, public API find-slot, mobile) for a
 * channel with a 09:00 London slot (E2E-05-85, E2E-10-59). The answer is a
 * UTC time without a zone suffix, as the clients expect.
 */
const build = (slots: Array<{ time: number; tz?: string }>, taken: string[] = []) => {
  const findMany = jest.fn(async ({ where }: any) =>
    where.publishDate.in
      .filter((d: Date) => taken.includes(d.toISOString()))
      .map((d: Date) => ({ publishDate: d }))
  );
  const repository = new PostsRepository(
    { model: { post: { findMany } } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  const service = new PostsService(
    repository,
    {} as any,
    { findFreeDateTime: jest.fn(async () => slots) } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return service;
};

afterEach(() => jest.useRealTimers());

const at = (now: string) => jest.useFakeTimers({ now: new Date(now), doNotFake: ['nextTick', 'setImmediate'] });

describe('next free posting time', () => {
  const nine = { time: 9 * 60, tz: 'Europe/London' };

  it('is 09:00 London (08:00 UTC) in summer time', async () => {
    at('2026-10-20T07:00:00Z');
    await expect(build([nine]).findFreeDateTime('org')).resolves.toBe('2026-10-20T08:00:00');
  });

  it('is 09:00 London (09:00 UTC) after the clocks go back', async () => {
    at('2026-10-26T07:00:00Z');
    await expect(build([nine]).findFreeDateTime('org')).resolves.toBe('2026-10-26T09:00:00');
  });

  it('skips a slot that has passed and one that is taken', async () => {
    at('2026-10-26T10:00:00Z');
    await expect(
      build([nine], ['2026-10-27T09:00:00.000Z']).findFreeDateTime('org')
    ).resolves.toBe('2026-10-28T09:00:00');
  });

  it('takes the earliest of slots in different zones', async () => {
    // 08:00 in New York = 13:00 UTC; 09:00 in London = 09:00 UTC (winter)
    at('2026-11-10T10:00:00Z');
    await expect(
      build([nine, { time: 8 * 60, tz: 'America/New_York' }]).findFreeDateTime('org')
    ).resolves.toBe('2026-11-10T13:00:00');
  });

  it('a zone far ahead of UTC can have its slot on the next calendar day first', async () => {
    // 07:00 in Auckland on 11 Nov = 18:00 UTC on 10 Nov, before 09:00 London on 11 Nov
    at('2026-11-10T10:00:00Z');
    await expect(
      build([nine, { time: 7 * 60, tz: 'Pacific/Auckland' }]).findFreeDateTime('org')
    ).resolves.toBe('2026-11-10T18:00:00');
  });

  it('still reads a slot saved without a zone as minutes after UTC midnight', async () => {
    at('2026-10-26T07:00:00Z');
    await expect(build([{ time: 480 }]).findFreeDateTime('org')).resolves.toBe('2026-10-26T08:00:00');
  });
});
