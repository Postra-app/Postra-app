jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  ...jest.requireActual('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator'),
  isSafePublicHttpsUrl: async () => true,
}));

import { AutopostService } from './autopost.service';

// E2E-06-24 (AI-3): eight new articles since the last run — the five newest
// were taken and the cursor moved to the newest, so the three older ones were
// never posted. A burst is now worked off oldest-first, five per run.
describe('a burst of new feed items', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({
    link: `https://blog.example/${i}`,
    pubDate: new Date(Date.UTC(2026, 9, 1, i)).toISOString(),
    description: `item ${i}`,
  }));
  const service = Object.create(AutopostService.prototype) as AutopostService;
  (service as any).fetchFeed = async () => ({ items });

  it('takes the oldest unpublished items first, and the rest next time', async () => {
    // Items 0 and 1 published before; 2…9 are new.
    const first = await service.loadNewLoads('https://blog.example/feed', 'https://blog.example/1', 5);
    expect(first.map((l: any) => l.url)).toEqual([2, 3, 4, 5, 6].map((i) => `https://blog.example/${i}`));
    const second = await service.loadNewLoads('https://blog.example/feed', 'https://blog.example/6', 5);
    expect(second.map((l: any) => l.url)).toEqual([7, 8, 9].map((i) => `https://blog.example/${i}`));
  });
});
