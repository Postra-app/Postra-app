const counts = new Map<string, number>();
const expires = new Map<string, number>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    incr: jest.fn(async (k: string) => {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k);
    }),
    expire: jest.fn(async (k: string, s: number) => expires.set(k, s)),
    get: jest.fn(async (k: string) => (counts.has(k) ? String(counts.get(k)) : null)),
  },
}));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import {
  countLinkedinPageCall,
  isLinkedinApiCall,
  linkedinPageCallsKey,
  linkedinPageCallsToday,
} from './linkedin-pages.usage';
import { LinkedinPageProvider } from './social/linkedin.page.provider';
import { LinkedinProvider } from './social/linkedin.provider';

// LinkedIn Pages share 500 API calls a day across every customer; nothing
// counted them, so a day running out showed only as LinkedIn refusing calls.

beforeEach(() => {
  counts.clear();
  expires.clear();
});

it('counts calls per UTC day in one shared key that expires', async () => {
  const day = new Date('2026-11-25T23:59:00Z');
  await countLinkedinPageCall(day);
  await countLinkedinPageCall(day);
  await countLinkedinPageCall(new Date('2026-11-26T00:00:01Z'));
  expect(await linkedinPageCallsToday(day)).toBe(2);
  expect(linkedinPageCallsKey(day)).toBe('linkedin-page:api-calls:2026-11-25');
  expect(expires.get('linkedin-page:api-calls:2026-11-25')).toBe(3 * 24 * 60 * 60);
});

it('counts only api.linkedin.com, where the budget is spent', () => {
  expect(isLinkedinApiCall('https://api.linkedin.com/rest/posts')).toBe(true);
  expect(isLinkedinApiCall(new URL('https://api.linkedin.com/v2/me'))).toBe(true);
  expect(isLinkedinApiCall('https://www.linkedin.com/oauth/v2/accessToken')).toBe(false);
  expect(isLinkedinApiCall('not a url')).toBe(false);
});

describe('the providers', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('a LinkedIn Page call to the API is counted, also through the page analytics', async () => {
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ elements: [] }), { status: 200 })) as any;
    const page = new LinkedinPageProvider();
    await (page as any).httpFetch('https://api.linkedin.com/rest/organizationalEntityShareStatistics', {});
    await (page as any).httpFetch('https://www.linkedin.com/oauth/v2/accessToken', {});
    await new Promise((r) => setImmediate(r));
    expect(await linkedinPageCallsToday()).toBe(1);
  });

  it('a personal LinkedIn call is not counted (another app, another budget)', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as any;
    await (new LinkedinProvider() as any).httpFetch('https://api.linkedin.com/v2/me', {});
    await new Promise((r) => setImmediate(r));
    expect(await linkedinPageCallsToday()).toBe(0);
  });
});
