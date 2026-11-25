import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from './auth.service';

// The campaign a sign-up came from reaches the new organisation on both
// roads: with the form (password) and through a sign-in provider, where it
// waits beside the sign-in state instead of in the visitor's browser.

const service = (overrides: Record<string, unknown> = {}) => {
  const s = Object.create(AuthService.prototype);
  const created: any[] = [];
  Object.assign(s, {
    _organizationService: {
      getCount: async () => 4,
      createOrgAndUser: async (body: any) => {
        created.push(body);
        return {
          id: 'org-new',
          users: [{ user: { id: 'user-new', activated: true } }],
        };
      },
      addUserToOrg: async (): Promise<boolean> => false,
    },
    _subscriptionService: {
      hasPendingGrant: async () => false,
      applyPendingGrant: async () => false,
    },
    _userService: {
      getUserByEmail: async (): Promise<null> => null,
      getUserByNormalizedEmail: async (): Promise<null> => null,
      getUserByProvider: async (): Promise<null> => null,
    },
    _providerManager: {
      getProvider: () => ({
        generateLink: () => 'https://provider.example/authorize',
        getToken: async () => 'access',
        getUser: async () => ({
          id: 'g-1',
          email: 'new@example.com',
          verified: true,
        }),
      }),
    },
    _track: async (): Promise<void> => undefined,
    ...overrides,
  });
  return { s, created };
};

const campaign = {
  signupSource: 'facebook',
  signupMedium: 'cpc',
  signupCampaign: 'launch-week',
};

describe('the campaign of a sign-up', () => {
  const before = process.env.DISABLE_REGISTRATION;
  beforeEach(() => {
    process.env.DISABLE_REGISTRATION = 'false';
  });
  afterAll(() => {
    process.env.DISABLE_REGISTRATION = before;
  });

  it('a new account through a provider passes it to the new organisation', async () => {
    const { s, created } = service();
    await s.loginOrRegisterProvider(
      'GOOGLE',
      {
        providerToken: 'tok',
        company: 'Example Ltd',
        termsAccepted: true,
        ...campaign,
      } as any,
      '1.2.3.4',
      'ua'
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject(campaign);
  });

  describe('across the trip to the provider', () => {
    const redis = ioRedis as any;
    const original = { set: redis.set, getdel: redis.getdel };
    let store: Map<string, string>;
    beforeEach(() => {
      store = new Map();
      redis.set = async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      };
      redis.getdel = async (key: string) => {
        const value = store.get(key) ?? null;
        store.delete(key);
        return value;
      };
    });
    afterEach(() => {
      redis.set = original.set;
      redis.getdel = original.getdel;
    });

    const state = () =>
      [...store.keys()]
        .find((key) => key.startsWith('auth-state:'))!
        .slice('auth-state:'.length);

    it('is kept with the sign-in state and handed to the sign-up form once', async () => {
      const { s } = service();
      const { nonce } = await s.oauthLink('GOOGLE', {
        utm_source: 'Facebook',
        utm_medium: 'cpc',
        utm_campaign: 'launch-week',
        fbclid: 'abc',
      });
      const stored = [...store.values()].join(' ');
      expect(stored).not.toContain('abc');

      const answer = await s.checkExists(
        'GOOGLE',
        'code',
        undefined,
        state(),
        nonce
      );
      expect(answer).toMatchObject({
        token: 'access',
        canRegister: true,
        signup: campaign,
      });
      // Both keys are spent with the state.
      expect(store.size).toBe(0);
    });

    it('a value that is not a short label is not kept', async () => {
      const { s } = service();
      const { nonce } = await s.oauthLink('GOOGLE', {
        utm_source: 'https://example.com/?a=1',
        utm_campaign: 'x'.repeat(65),
      });
      expect([...store.keys()]).toEqual([`auth-state:${state()}`]);
      const answer = await s.checkExists(
        'GOOGLE',
        'code',
        undefined,
        state(),
        nonce
      );
      expect(answer).toMatchObject({ token: 'access', canRegister: true });
    });

    it('a sign-in without a campaign stores the state only', async () => {
      const { s } = service();
      await s.oauthLink('GOOGLE', {});
      expect(store.size).toBe(1);
    });
  });
});
