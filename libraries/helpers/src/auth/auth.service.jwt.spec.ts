import { sign } from 'jsonwebtoken';
import { AuthService } from './auth.service';

describe('AuthService JWT algorithm (E2E-11-79)', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('signs with HS256', () => {
    const token = AuthService.signJWT({ id: 'u1' });
    const header = JSON.parse(
      Buffer.from(token.split('.')[0], 'base64url').toString()
    );
    expect(header.alg).toBe('HS256');
  });

  it('accepts its own tokens', () => {
    const token = AuthService.signJWT({ id: 'u1' });
    expect((AuthService.verifyJWT(token) as any).id).toBe('u1');
  });

  // Verification took whatever HMAC the token named. Every token Postra
  // issues is HS256, so anything else is not ours (RFC 8725 §3.1: the caller
  // names the algorithms it accepts).
  it.each(['HS384', 'HS512'] as const)('refuses a token signed with %s', (alg) => {
    const token = sign({ id: 'u1' }, 'test-secret', { algorithm: alg });
    expect(() => AuthService.verifyJWT(token)).toThrow();
  });

  it('refuses an unsigned token', () => {
    const token = sign({ id: 'u1' }, '', { algorithm: 'none' } as any);
    expect(() => AuthService.verifyJWT(token)).toThrow();
  });
});
