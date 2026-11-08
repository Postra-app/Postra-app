jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
// SocialAbstract.fetch waits 5 s between retries of a 429.
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => undefined }));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { isTransientRefreshError } from './refresh.integration.service';
import { InstagramStandaloneProvider } from './social/instagram.standalone.provider';
import { ThreadsProvider } from './social/threads.provider';
import { PinterestProvider } from './social/pinterest.provider';
import { TiktokProvider } from './social/tiktok.provider';
import { WhopProvider } from './social/whop.provider';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

/**
 * A refresh that hits an outage at the provider (429, 5xx) is let through by
 * `isTransientRefreshError`: the channel stays connected for the next
 * attempt. That only works when the error still carries the HTTP status.
 *
 * Most refreshers lost it. Instagram, Pinterest, TikTok and Whop read the
 * JSON of any answer and came back without a token, which reads as a revoked
 * grant; providers on `SocialAbstract.fetch` (Threads, Discord, Reddit, …)
 * threw a `BadBody` with no status. Either way one 503 from the platform
 * marked a healthy channel "reconnect needed" and e-mailed the customer to
 * connect it again.
 */
const realFetch = global.fetch;
afterEach(() => (global.fetch = realFetch));

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const answerAll = (status: number, body: unknown) => {
  global.fetch = jest.fn(async () => reply(status, body)) as any;
};

const failure = (p: Promise<unknown>) =>
  p.then(
    (v) => ({ resolved: v }),
    (e) => ({ error: e })
  );

const outage = { error: { message: 'Service temporarily unavailable', code: 2 } };

const providers: [string, () => Promise<unknown>][] = [
  ['instagram-standalone', () => new InstagramStandaloneProvider().refreshToken('t')],
  ['threads', () => new ThreadsProvider().refreshToken('t')],
  ['pinterest', () => new PinterestProvider().refreshToken('t')],
  ['tiktok', () => new TiktokProvider().refreshToken('t')],
  ['whop', () => new WhopProvider().refreshToken('t')],
];

describe('a provider outage during a refresh keeps its status', () => {
  it.each(providers)('%s: a 503 is a passing outage', async (_name, run) => {
    answerAll(503, outage);
    const outcome: any = await failure(run());
    expect(outcome.error).toBeDefined(); // a 503 must not come back as a token
    expect(isTransientRefreshError(outcome.error)).toBe(true);
  });

  it.each(providers)('%s: a 429 is a passing outage', async (_name, run) => {
    answerAll(429, { error: { message: 'Too many calls' } });
    const outcome: any = await failure(run());
    expect(outcome.error).toBeDefined();
    expect(isTransientRefreshError(outcome.error)).toBe(true);
  });

  it('instagram: a refused token says why and still asks for a reconnect', async () => {
    answerAll(400, {
      error: { message: 'Error validating access token: Session has expired', code: 190 },
    });
    const outcome: any = await failure(new InstagramStandaloneProvider().refreshToken('t'));
    expect(outcome.error?.message).toContain('Session has expired');
    expect(isTransientRefreshError(outcome.error)).toBe(false);
  });

  it('a refused token never echoes the token back into the message', async () => {
    answerAll(400, { error: { message: 'Invalid access_token=SECRET123' } });
    const outcome: any = await failure(new InstagramStandaloneProvider().refreshToken('t'));
    expect(outcome.error?.message).not.toContain('SECRET123');
  });
});

// The `refresh` command refreshes due channels itself, outside the service
// above, and flagged every failure the same way.
describe('refresh command', () => {
  const channel = {
    id: 'i1',
    organizationId: 'o1',
    name: 'c',
    providerIdentifier: 'threads',
    refreshToken: 'r',
    internalId: 'x',
    tokenExpiration: new Date(Date.now() - 1000),
  };
  const build = (err: unknown) => {
    const repository = {
      needsToBeRefreshed: jest.fn(async () => [channel]),
      refreshNeeded: jest.fn(async () => true),
    };
    const provider = { refreshCron: true, refreshToken: jest.fn().mockRejectedValue(err) };
    const service = new IntegrationService(
      repository as any,
      {} as any,
      { getSocialIntegration: () => provider } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    const inform = jest.spyOn(service, 'informAboutRefreshError').mockResolvedValue(undefined as any);
    return { service, repository, inform };
  };

  it('an outage is reported as failed but leaves the channel connected', async () => {
    const { service, repository, inform } = build(Object.assign(new Error('down'), { status: 503 }));
    const result = await service.refreshTokens(true);
    expect(result.failed).toHaveLength(1);
    expect(repository.refreshNeeded).not.toHaveBeenCalled();
    expect(inform).not.toHaveBeenCalled();
  });

  it('a refused grant still marks the channel for reconnecting', async () => {
    const { service, repository } = build(Object.assign(new Error('invalid_grant'), { status: 400 }));
    await service.refreshTokens(true);
    expect(repository.refreshNeeded).toHaveBeenCalledWith('o1', 'i1');
  });
});
