jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...a: unknown[]) => fetchMock(...a) }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: jest.fn().mockResolvedValue(true),
}));

import { AutopostService } from './autopost.service';

// Auto Post reads the article behind a feed item with jsdom (the one
// production dependency on it): scripts and styles out, text in. Guards the
// jsdom major (22 → 30, 2 XI).
it('reads the article text without its scripts and styles', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      '<html><head><style>.a{color:red}</style></head><body><h1>Launch week</h1>' +
        '<script>window.track("x")</script><p>Postra goes <b>live</b>.</p></body></html>'
    )
  );
  const service = Object.create(AutopostService.prototype) as any;
  const text: string = await service.loadUrl('https://blog.example/post');
  expect(text).toContain('Launch week');
  expect(text).toContain('Postra goes live.');
  expect(text).not.toContain('track');
  expect(text).not.toContain('color:red');
  expect(text).not.toContain('<');
});

it('gives up quietly when the page cannot be read', async () => {
  fetchMock.mockRejectedValue(new Error('ECONNRESET'));
  const service = Object.create(AutopostService.prototype) as any;
  await expect(service.loadUrl('https://blog.example/post')).resolves.toBe('');
});
