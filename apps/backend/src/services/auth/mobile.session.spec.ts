import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

// The deny list is the only part that needs a stand-in; everything else is
// signing and verifying real tokens.
const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string) => {
      store.set(k, '1');
      return 'OK';
    }),
    exists: jest.fn(async (k: string) => (store.has(k) ? 1 : 0)),
  },
}));

import {
  isMobileSessionRevoked,
  revokeMobileSession,
  MOBILE_TOKEN_TTL_SECONDS,
} from '@gitroom/nestjs-libraries/redis/mobile-session';
import { AuthService } from './auth.service';

function makeService() {
  return new AuthService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
}

describe('mobile session (E2E-10-17)', () => {
  const WEB_JWT = () =>
    AuthChecker.signJWT({ id: 'u1', email: 'a@b.c', tokenVersion: 3 });

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    store.clear();
  });

  it('gives the app a token that carries a session id and dies within a week', () => {
    const token = makeService().mobileJwt(WEB_JWT());
    const payload = AuthChecker.verifyJWT(token) as any;

    expect(payload.sid).toEqual(expect.any(String));
    expect(payload.id).toBe('u1');
    expect(payload.tokenVersion).toBe(3);
    // Web tokens live 30 days; this one must not.
    expect(payload.exp - payload.iat).toBe(MOBILE_TOKEN_TTL_SECONDS);
  });

  it('leaves the browser token alone — it carries no session id', () => {
    const payload = AuthChecker.verifyJWT(WEB_JWT()) as any;
    expect(payload.sid).toBeUndefined();
    expect(payload.exp - payload.iat).toBe(30 * 24 * 60 * 60);
  });

  it('refresh keeps the session id, so the session stays one session', () => {
    const service = makeService();
    const first = service.mobileJwt(WEB_JWT());
    const second = service.refreshMobileJwt(first);

    const a = AuthChecker.verifyJWT(first) as any;
    const b = AuthChecker.verifyJWT(second) as any;
    expect(b.sid).toBe(a.sid);
  });

  it('signing out revokes the session — and every token refresh handed out', async () => {
    const service = makeService();
    const first = service.mobileJwt(WEB_JWT());
    const refreshed = service.refreshMobileJwt(first);

    await service.endMobileSession(refreshed);

    const { sid } = AuthChecker.verifyJWT(first) as any;
    await expect(isMobileSessionRevoked(sid)).resolves.toBe(true);
  });

  it('signing out on the web revokes nothing — there is no session id to revoke', async () => {
    const service = makeService();
    await expect(service.endMobileSession(WEB_JWT())).resolves.toBeUndefined();
    expect(store.size).toBe(0);
  });

  it('an unreadable token is ignored rather than thrown over', async () => {
    await expect(
      makeService().endMobileSession('not-a-jwt')
    ).resolves.toBeUndefined();
  });

  it('a session nobody revoked is live', async () => {
    await expect(isMobileSessionRevoked('never-seen')).resolves.toBe(false);
    await revokeMobileSession('seen');
    await expect(isMobileSessionRevoked('seen')).resolves.toBe(true);
  });
});
