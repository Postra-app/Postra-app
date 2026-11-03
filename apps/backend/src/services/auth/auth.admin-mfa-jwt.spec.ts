import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthService } from './auth.service';

// After an administrator's code the browser gets the same session back with
// `mfa` added: signing out still ends it, and it still ends 30 days after
// signing in. The app's token never carries the claim.

const service = () =>
  new AuthService({} as any, {} as any, {} as any, {} as any, {} as any);

const decode = (jwt: string) => AuthChecker.verifyJWT(jwt) as any;

describe('the session after an administrator code', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('keeps the session id, sign-in time, version and expiry, and adds mfa', () => {
    const signedInAt = Math.floor(Date.now() / 1000) - 3600;
    const web = AuthChecker.signJWT(
      { id: 'u1', email: 'a@b.c', tokenVersion: 4, sid: 's-1', sat: signedInAt },
      { expiresIn: 5 * 86400 }
    );
    const before = decode(web);
    const after = decode(service().adminMfaJwt(web));

    expect(after).toMatchObject({ id: 'u1', email: 'a@b.c', tokenVersion: 4, sid: 's-1', sat: signedInAt });
    expect(Math.abs(after.exp - before.exp)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.mfa - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(1);
  });

  it('does not pass mfa on to the app token made from it', () => {
    const web = AuthChecker.signJWT({ id: 'u1', email: 'a@b.c', tokenVersion: 1, sid: 's-2' });
    const elevated = service().adminMfaJwt(web);
    expect(decode(service().mobileJwt(elevated)).mfa).toBeUndefined();
  });

  it('refuses a token that is not ours', () => {
    expect(() => service().adminMfaJwt('not-a-jwt')).toThrow();
  });
});
