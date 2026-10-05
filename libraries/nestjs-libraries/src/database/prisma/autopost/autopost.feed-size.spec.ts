jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...a: unknown[]) => fetchMock(...a) }));

import { AutopostService } from './autopost.service';

// AI-10: the feed body was read whole with res.text(), whatever its size.
it('a feed larger than the ceiling is refused before it is read into memory', async () => {
  const big = 'x'.repeat(11 * 1024 * 1024);
  fetchMock.mockResolvedValue(new Response(big, { headers: { 'content-length': String(big.length) } }));
  const service = Object.create(AutopostService.prototype) as any;
  await expect(service.fetchFeed('https://blog.example/feed.xml')).rejects.toThrow(/larger than/);
});
