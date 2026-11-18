// "Send Test" answered { send: true } whatever happened at the receiver:
// a refusal, a 500 or an address that never answered all read as sent.
jest.mock('undici', () => ({ fetch: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  ...jest.requireActual('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator'),
  isSafePublicHttpsUrl: jest.fn(async () => true),
}));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({
  ssrfSafeDispatcher: {},
}));

import { fetch } from 'undici';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { WebhookController } from './webhooks.controller';

const controller = () => new WebhookController({ getSecret: jest.fn() } as any);
const org = { id: 'org-1' } as any;
const send = () => controller().sendWebhook(org, [{ test: true }], { url: 'https://hooks.example.com/x' } as any);

describe('POST /webhooks/send', () => {
  beforeEach(() => {
    (isSafePublicHttpsUrl as jest.Mock).mockResolvedValue(true);
  });

  it('says sent with the status when the receiver accepts', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: true, status: 204 });
    await expect(send()).resolves.toEqual({ send: true, status: 204 });
  });

  it('says not accepted, with the status, when the receiver refuses', async () => {
    (fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });
    await expect(send()).resolves.toEqual({ send: false, reason: 'status', status: 500 });
  });

  it('says unreachable when nothing answers', async () => {
    (fetch as jest.Mock).mockRejectedValue(new Error('timeout'));
    await expect(send()).resolves.toEqual({ send: false, reason: 'unreachable' });
  });

  it('says not allowed for an address inside a network', async () => {
    (isSafePublicHttpsUrl as jest.Mock).mockResolvedValue(false);
    await expect(send()).resolves.toEqual({ send: false, reason: 'not-allowed' });
  });
});
