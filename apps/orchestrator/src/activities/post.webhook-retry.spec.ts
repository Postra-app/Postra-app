jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...args: unknown[]) => fetchMock(...args) }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));
jest.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '93.184.216.34', family: 4 }) }));

import { PostActivity } from './post.activity';

// POSTS-6: a receiver answering 429/503 or timing out lost the event for good:
// the response was never checked and errors were swallowed.
const activity = () => {
  const a = Object.create(PostActivity.prototype) as any;
  Object.assign(a, {
    _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    _webhookService: {
      getWebhooks: async () => [
        { id: 'w-flaky', url: 'https://flaky.example/hook', integrations: [] },
        { id: 'w-ok', url: 'https://ok.example/hook', integrations: [] },
      ],
    },
    _postService: { getPostByForWebhookId: async () => ({ id: 'p1' }) },
  });
  return a;
};
const calls = (host: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(host)).length;

beforeEach(() => fetchMock.mockReset());

it('a receiver that is briefly down gets the event again; the others once', async () => {
  let flaky = 0;
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes('flaky')) {
      flaky++;
      if (flaky === 1) return { status: 503 };
      if (flaky === 2) throw new Error('timeout');
      return { status: 200 };
    }
    return { status: 200 };
  });
  await activity().sendWebhooks('p1', 'o1', 'i1');
  expect(calls('flaky')).toBe(3);
  expect(calls('ok.example')).toBe(1);
});

it('a receiver that refuses the event (4xx) is not retried', async () => {
  fetchMock.mockResolvedValue({ status: 404 });
  await activity().sendWebhooks('p1', 'o1', 'i1');
  expect(calls('flaky')).toBe(1);
});
