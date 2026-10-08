jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const fetchMock = jest.fn();
jest.mock('undici', () => ({ ...jest.requireActual('undici'), fetch: (...args: unknown[]) => fetchMock(...args) }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));
jest.mock('node:dns/promises', () => ({ lookup: async () => ({ address: '93.184.216.34', family: 4 }) }));

import { createHmac } from 'crypto';
import { PostActivity } from './post.activity';
import { verifyWebhookSignature } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.signature';

// E2E-08-49: deliveries carried no signature, so a receiver could not tell a
// request from Postra from one anybody sent to its address.
const post = [{ id: 'p1', content: 'Hello', integration: { id: 'i1', name: 'Channel' } }];
const webhooks = [
  { id: 'w1', url: 'https://one.example/hook', integrations: [], secret: 'whsec_one' },
  { id: 'w2', url: 'https://two.example/hook', integrations: [], secret: 'whsec_two' },
];
const activity = () => {
  const a = Object.create(PostActivity.prototype) as any;
  Object.assign(a, {
    _logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    _webhookService: {
      getWebhooksForDelivery: async () => webhooks,
      getWebhooks: async () => webhooks,
    },
    _postService: { getPostByForWebhookId: async () => post },
  });
  return a;
};
const sent = (host: string) => {
  const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes(host))!;
  return { body: init.body as string, headers: init.headers as Record<string, string> };
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ status: 200 });
});

it('each delivery is signed with its own webhook secret over the exact body', async () => {
  await activity().sendWebhooks('p1', 'o1', 'i1');
  for (const [host, id, secret] of [
    ['one.example', 'w1', 'whsec_one'],
    ['two.example', 'w2', 'whsec_two'],
  ]) {
    const { body, headers } = sent(host);
    expect(JSON.parse(body)).toEqual(post);
    expect(headers['Postra-Webhook-Id']).toBe(id);
    const [, t, v1] = headers['Postra-Signature'].match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
    // Computed here independently: HMAC-SHA256 of "<t>.<body>".
    expect(v1).toBe(createHmac('sha256', secret).update(`${t}.${body}`).digest('hex'));
    expect(verifyWebhookSignature(secret, body, headers['Postra-Signature'])).toBe(true);
  }
});

it('a changed body, another secret or an old delivery does not verify', async () => {
  await activity().sendWebhooks('p1', 'o1', 'i1');
  const { body, headers } = sent('one.example');
  const signature = headers['Postra-Signature'];
  expect(verifyWebhookSignature('whsec_one', body.replace('Hello', 'Hullo'), signature)).toBe(false);
  expect(verifyWebhookSignature('whsec_two', body, signature)).toBe(false);
  const t = Number(signature.match(/t=(\d+)/)![1]);
  expect(verifyWebhookSignature('whsec_one', body, signature, 300, t + 301)).toBe(false);
});
