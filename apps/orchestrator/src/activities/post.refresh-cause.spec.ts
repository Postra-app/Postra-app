jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PostActivity } from './post.activity';

// Upstream #1884: when the token refreshed but the channel could not be
// reached again, the customer was told "could not refresh" with no reason,
// and the reason itself was dropped.
describe('a refresh that fails after the token was renewed', () => {
  const run = async (method: 'refreshToken' | 'refreshTokenWithCause', cause?: string) => {
    const setBetweenSteps = jest.fn();
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _integrationManager: { getSocialIntegration: () => ({}) },
      _refreshIntegrationService: {
        refresh: jest.fn().mockRejectedValue(new Error('Request had insufficient authentication scopes.')),
        setBetweenSteps,
      },
    });
    const integration = { id: 'i1', organizationId: 'o1', providerIdentifier: 'youtube' };
    await expect(activity[method](integration, cause)).resolves.toBe(false);
    return setBetweenSteps.mock.calls[0][1];
  };

  it('passes the reason on', async () => {
    expect(await run('refreshToken')).toBe('Request had insufficient authentication scopes.');
  });

  it('keeps the cause it was given, and falls back to the reason', async () => {
    expect(await run('refreshTokenWithCause', '(publishing)')).toBe('(publishing)');
    expect(await run('refreshTokenWithCause', '')).toBe('Request had insufficient authentication scopes.');
  });
});
