jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

process.env.JWT_SECRET = process.env.JWT_SECRET || 'stack-test-secret';

import { BskyAgent } from '@atproto/api';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { BlueskyProvider, loginRefusedCredentials } from './bluesky.provider';

// A Bluesky outage (502 from its load balancer) flagged channels "reconnect
// needed" and failed every following post; only a refusal of the
// credentials should (upstream 0b26c98e).
describe('Bluesky login failures', () => {
  it('a 4xx refusal means the credentials are broken', () => {
    for (const status of [400, 401, 403]) {
      expect(loginRefusedCredentials({ status })).toBe(true);
    }
  });

  it('an outage, rate limit or network error does not', () => {
    for (const err of [{ status: 429 }, { status: 500 }, { status: 502 }, new Error('fetch failed'), undefined]) {
      expect(loginRefusedCredentials(err)).toBe(false);
    }
  });

  describe('when publishing (getAgent)', () => {
    const integration = {
      customInstanceDetails: AuthService.fixedEncryption(
        JSON.stringify({ service: 'https://bsky.social', identifier: 'a.bsky.social', password: 'x' })
      ),
    } as any;
    const login = jest.spyOn(BskyAgent.prototype, 'login');
    afterAll(() => login.mockRestore());

    it('a 502 from Bluesky is passed on as an outage, not "reconnect needed"', async () => {
      const outage = Object.assign(new Error('UpstreamFailure'), { status: 502 });
      login.mockRejectedValueOnce(outage);
      const failure = await (new BlueskyProvider() as any).getAgent(integration).catch((e: unknown) => e);
      expect(failure).toBe(outage);
      expect(failure).not.toBeInstanceOf(RefreshToken);
    });

    it('a 401 still asks for the channel to be reconnected', async () => {
      login.mockRejectedValueOnce(Object.assign(new Error('AuthFactorTokenRequired'), { status: 401 }));
      await expect((new BlueskyProvider() as any).getAgent(integration)).rejects.toBeInstanceOf(RefreshToken);
    });
  });
});
