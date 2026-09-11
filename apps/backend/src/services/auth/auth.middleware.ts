import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { User } from '@prisma/client';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  AUTH_CACHE_TTL_SECONDS,
  authContextCacheKey,
  bustAuthContextCache,
} from '@gitroom/nestjs-libraries/redis/auth-context.cache';
import {
  AuditActor,
  runWithAuditActor,
} from '@gitroom/nestjs-libraries/database/prisma/audit/audit.actor';
import { setImpersonateCookie } from '@gitroom/backend/services/auth/impersonate.cookie';

/**
 * Routes a session wearing someone else's identity may not reach.
 *
 * The admin surface acts on everybody, so reaching it from inside an
 * impersonated session means the action lands under the customer's name. The
 * one exception is `/user/impersonate`, which is how the session gets out.
 */
const FORBIDDEN_WHILE_IMPERSONATING = ['/admin', '/billing/add-subscription'];

// Re-exported so existing callers keep importing the buster from the middleware.
export { authContextCacheKey, bustAuthContextCache };

export const removeAuth = (res: Response) => {
  res.cookie('auth', '', {
    domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
    ...(!process.env.NOT_SECURED
      ? {
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        }
      : {}),
    expires: new Date(0),
    maxAge: -1,
  });
  res.header('logout', 'true');
};

// Audit rows had no ip and no userAgent on any action (E2E-09-34); the columns
// existed and nothing filled them.
const requestFingerprint = (req: Request) => ({
  ip: (
    (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
    req.ip ||
    ''
  ).trim(),
  userAgent: (req.headers['user-agent'] as string) || '',
});

@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(
    private _organizationService: OrganizationService,
    private _userService: UsersService
  ) {}
  async use(req: Request, res: Response, next: NextFunction) {
    let actor: AuditActor = {};
    const auth = req.headers.auth || req.cookies.auth;
    if (!auth) {
      throw new HttpForbiddenException();
    }
    try {
      // Verify the JWT signature only. Never trust authorization-relevant
      // claims (id, isSuperAdmin, activated) from the token body — always
      // re-resolve the user from the database using the id.
      const payload = AuthService.verifyJWT(auth) as User | null;
      const orgHeader = req.cookies.showorg || req.headers.showorg;

      if (!payload?.id) {
        throw new HttpForbiddenException();
      }

      const cacheKey = authContextCacheKey(payload.id);
      const cached = await ioRedis.get(cacheKey).catch(() => null);
      let user: User | null = null;
      let organization: any[] | null = null;
      if (cached) {
        try {
          ({ user, organization } = JSON.parse(cached));
        } catch {
          user = null;
          organization = null;
        }
      }

      if (!user) {
        user = (await this._userService.getUserById(payload.id)) as User | null;
      }

      if (!user) {
        throw new HttpForbiddenException();
      }

      if (!user.activated) {
        throw new HttpForbiddenException();
      }

      // Revocation gate: a token is only valid while its version matches the
      // user's current one. A password reset bumps user.tokenVersion (and busts
      // the authctx cache), so every JWT issued beforehand — including a
      // stolen/leaked one — stops here. Tokens minted before this column
      // existed carry no version and are treated as stale (one forced re-login).
      if ((payload as any).tokenVersion !== user.tokenVersion) {
        throw new HttpForbiddenException();
      }

      const impersonate = req.cookies.impersonate || req.headers.impersonate;
      if (user?.isSuperAdmin && impersonate) {
        const loadImpersonate = await this._organizationService.getUserOrg(
          impersonate
        );

        if (loadImpersonate) {
          const admin = user;
          user = loadImpersonate.user;
          delete user.password;

          // The session carries the target's own permissions, not the admin's.
          // Forcing isSuperAdmin=true here meant every `user.isSuperAdmin` gate
          // in the product kept opening while the identity behind the request
          // was the customer's — grant-admin, add-subscription and the debug
          // export all worked, and every audit row named the customer
          // (E2E-09-23). The real admin travels separately.
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.impersonatedBy = admin.id;

          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.user = user;

          // @ts-ignore
          loadImpersonate.organization.users =
            loadImpersonate.organization.users.filter(
              (f) => f.userId === user.id
            );
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-expect-error
          req.org = loadImpersonate.organization;

          const path = req.path || req.url || '';
          if (FORBIDDEN_WHILE_IMPERSONATING.some((p) => path.startsWith(p))) {
            throw new HttpForbiddenException();
          }

          // Sliding window: the impersonation lapses after inactivity rather
          // than running for a year (E2E-09-28).
          setImpersonateCookie(res, impersonate);

          runWithAuditActor(
            {
              userId: admin.id,
              impersonatedUserId: user.id,
              ...requestFingerprint(req),
            },
            next
          );
          return;
        }
      }

      delete user.password;
      if (!organization) {
        organization = await this._organizationService.getOrgsByUserId(user.id);
        await ioRedis
          .set(
            cacheKey,
            JSON.stringify({ user, organization }),
            'EX',
            AUTH_CACHE_TTL_SECONDS
          )
          .catch(() => {});
      }
      organization = organization.filter((f: any) => !f.users[0].disabled);
      const setOrg =
        organization.find((org) => org.id === orgHeader) || organization[0];

      if (!organization) {
        throw new HttpForbiddenException();
      }

      if (!setOrg.apiKey) {
        await this._organizationService.updateApiKey(setOrg.id);
        // Next request must see the generated key, not the cached null.
        await bustAuthContextCache(user.id);
      }

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.user = user;

      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error
      req.org = setOrg;

      actor = { userId: user.id, ...requestFingerprint(req) };
    } catch (err) {
      throw new HttpForbiddenException();
    }
    runWithAuditActor(actor, next);
  }
}
