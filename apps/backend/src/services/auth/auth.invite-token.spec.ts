import dayjs from 'dayjs';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));

import { AuthService } from './auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const service = () =>
  new AuthService({} as any, {} as any, {} as any, {} as any, {} as any);

/**
 * An invitation is a JWT in a link. Accepting one checked the
 * signature and a `timeLimit`, and a token with no `timeLimit` passed as never
 * expiring: every token Postra signs (a session, a reset link, an extension
 * token) read as an invitation that never runs out. Invitations now say what
 * they are, and one without an expiry is not one.
 */
describe('invitation tokens', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
    // The invitation link is built on it; CI has no .env.
    process.env.FRONTEND_URL = 'https://app.postra.co.uk';
  });

  const invite = (extra: Record<string, unknown> = {}) =>
    AuthChecker.signJWT({
      purpose: 'invite',
      email: 'new@example.com',
      role: 'USER',
      orgId: 'org-1',
      id: 'abcde',
      timeLimit: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
      ...extra,
    });

  it('accepts an invitation within its hour', () => {
    expect(service().getOrgFromCookie(invite())).toMatchObject({
      orgId: 'org-1',
      role: 'USER',
    });
  });

  it('refuses an expired invitation', () => {
    const expired = invite({
      timeLimit: dayjs().subtract(1, 'minute').format('YYYY-MM-DD HH:mm:ss'),
    });
    expect(service().getOrgFromCookie(expired)).toBe(false);
  });

  it('refuses a token without an expiry', () => {
    const { timeLimit: _t, ...rest } = AuthChecker.verifyJWT(invite()) as any;
    const noExpiry = AuthChecker.signJWT({
      purpose: rest.purpose,
      orgId: rest.orgId,
      role: rest.role,
      id: rest.id,
    });
    expect(service().getOrgFromCookie(noExpiry)).toBe(false);
  });

  it('refuses a token that is not an invitation', () => {
    const session = AuthChecker.signJWT({
      id: 'u1',
      orgId: 'org-1',
      role: 'ADMIN',
      timeLimit: dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss'),
    });
    expect(service().getOrgFromCookie(session)).toBe(false);
  });

  it('issues invitations that say what they are', async () => {
    const org = new OrganizationService(
      {} as any,
      { sendEmail: jest.fn() } as any
    );
    const { url } = await org.inviteTeamMember('org-1', {
      email: 'new@example.com',
      role: 'USER',
      sendEmail: false,
    });
    const token = new URL(url).searchParams.get('org')!;
    expect((AuthChecker.verifyJWT(token) as any).purpose).toBe('invite');
  });
});
