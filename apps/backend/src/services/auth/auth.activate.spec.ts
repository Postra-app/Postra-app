jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService, ACTIVATION_LINK_INVALID } = require('./auth.service');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AuthService: AuthChecker } = require('@gitroom/helpers/auth/auth.service');

// A mangled or expired activation link answered `false`, the same as a link
// that was already used, so the page told its owner "This user is already
// activated" (production, 2026-10-22, E2E-11-50). The two cases differ.
describe('activation link', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  it('a code that does not verify is invalid, not "already activated"', async () => {
    const service = Object.create(AuthService.prototype);
    await expect(service.activate('not-a-token', '')).rejects.toThrow(
      ACTIVATION_LINK_INVALID
    );
  });

  it('a used link (account already active) stays false', async () => {
    const service = Object.create(AuthService.prototype);
    Object.assign(service, {
      _userService: {
        getUserByEmail: async () => ({
          id: 'u1',
          email: 'a@b.co',
          activated: true,
        }),
      },
    });
    const code = AuthChecker.signJWT({
      id: 'u1',
      activated: false,
      email: 'a@b.co',
    });
    await expect(service.activate(code, '')).resolves.toBe(false);
  });
});
