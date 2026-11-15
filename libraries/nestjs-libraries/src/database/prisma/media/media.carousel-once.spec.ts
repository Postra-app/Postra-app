jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const store = new Map<string, string>();
let redisDown = false;
const down = () => {
  if (redisDown) throw new Error('redis down');
};
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: async (key: string) => {
      down();
      return store.get(key) ?? null;
    },
    set: async (key: string, value: string, ...rest: unknown[]) => {
      down();
      if (rest.includes('NX') && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    del: async (key: string) => {
      down();
      return store.delete(key) ? 1 : 0;
    },
  },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => new Promise((r) => setImmediate(r)) }));

import { MediaService } from './media.service';

// A carousel is up to ten pictures and can outlast the browser's wait. Asked
// again after a timeout or a second click, it was designed again from nothing
// and every picture was paid for a second time.
const carousel = { slides: [{ headline: 'a', cacheHit: false }, { headline: 'b', cacheHit: false }] };
const org = { id: 'org1' } as any;
// Each test asks for its own carousel: the ones in flight are kept per
// process, across service instances.
let n = 0;
let dto: any;

const service = () => {
  const s = Object.create(MediaService.prototype) as any;
  s.assertStorage = jest.fn();
  let finish!: (value: unknown) => void;
  let fail!: (err: unknown) => void;
  s.makePostCarousel = jest.fn(
    () =>
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      })
  );
  return { s, finish: (v: unknown = carousel) => finish(v), fail: (e: unknown) => fail(e) };
};

beforeEach(() => {
  dto = { prompt: `Five tips for a bakery ${++n}`, platform: 'instagram-feed', slidesCount: 2 };
  store.clear();
  redisDown = false;
});

it('the same request twice at once makes one carousel, and both get it', async () => {
  const { s, finish } = service();
  const first = s.generatePostCarousel(org, dto);
  const second = s.generatePostCarousel(org, { ...dto });
  await new Promise((r) => setImmediate(r));
  finish();
  expect(await first).toEqual(carousel);
  expect(await second).toEqual(carousel);
  expect(s.makePostCarousel).toHaveBeenCalledTimes(1);
});

it('asked again after it is made (a timeout, a second click), it is answered without making or paying again', async () => {
  const { s, finish } = service();
  const first = s.generatePostCarousel(org, dto);
  await new Promise((r) => setImmediate(r));
  finish();
  await first;
  const again = await s.generatePostCarousel(org, dto);
  expect(s.makePostCarousel).toHaveBeenCalledTimes(1);
  expect(again.slides.map((x: any) => x.headline)).toEqual(['a', 'b']);
  // Nothing was generated for this request.
  expect(again.slides.every((x: any) => x.cacheHit)).toBe(true);
});

it('another process making it is waited for, not doubled', async () => {
  const a = service();
  const b = service();
  const first = a.s.generatePostCarousel(org, dto);
  await new Promise((r) => setImmediate(r));
  // `b` stands for a second backend process: it has no promise to join,
  // only the key in Redis.
  const waiting = (b.s as any).carouselOnce(org, dto, [...store.keys()][0]);
  a.finish();
  await first;
  expect((await waiting).slides).toHaveLength(2);
  expect(b.s.makePostCarousel).not.toHaveBeenCalled();
});

it('a carousel that failed is not kept: the next try makes it again, and a waiter is told to try again', async () => {
  const { s, fail } = service();
  const first = s.generatePostCarousel(org, dto);
  await new Promise((r) => setImmediate(r));
  const waiting = (s as any).waitForCarousel([...store.keys()][0]);
  fail(new Error('image model down'));
  await expect(first).rejects.toThrow('image model down');
  await expect(waiting).rejects.toMatchObject({ status: 502 });
  expect(store.size).toBe(0);
  const retry = service();
  retry.s.generatePostCarousel(org, dto);
  await new Promise((r) => setImmediate(r));
  expect(retry.s.makePostCarousel).toHaveBeenCalledTimes(1);
});

it('a different brief, slide count or organisation is a different carousel', async () => {
  const { s } = service();
  s.generatePostCarousel(org, dto);
  s.generatePostCarousel(org, { ...dto, slidesCount: 3 });
  s.generatePostCarousel(org, { ...dto, prompt: 'Six tips for a bakery' });
  await new Promise((r) => setImmediate(r));
  s.generatePostCarousel({ id: 'org2' }, dto);
  await new Promise((r) => setImmediate(r));
  expect(s.makePostCarousel).toHaveBeenCalledTimes(4);
});

it('with Redis away the carousel is still made', async () => {
  redisDown = true;
  const { s, finish } = service();
  const made = s.generatePostCarousel(org, dto);
  await new Promise((r) => setImmediate(r));
  finish();
  expect(await made).toEqual(carousel);
});
