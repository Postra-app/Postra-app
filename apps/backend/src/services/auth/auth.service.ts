import { Injectable, Logger } from '@nestjs/common';
import { Provider, User } from '@prisma/client';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { AuthProviderManager } from '@gitroom/backend/services/auth/providers/providers.manager';
import dayjs from 'dayjs';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { normalizeEmail } from '@gitroom/helpers/utils/email.normalize';
import disposableDomains from 'disposable-email-domains';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { bustAuthContextCache } from '@gitroom/nestjs-libraries/redis/auth-context.cache';
import {
  authEmails,
  EmailLang,
} from '@gitroom/backend/services/auth/auth.emails';
import {
  isPwnedPassword,
  PWNED_PASSWORD_MESSAGE,
} from '@gitroom/backend/services/auth/pwned.passwords';
import { randomBytes } from 'crypto';

// Per-account login lockout (brute-force defense, independent of IP throttling).
const MAX_LOGIN_FAILURES = 10;
const LOGIN_LOCKOUT_WINDOW_SECONDS = 15 * 60;

@Injectable()
export class AuthService {
  constructor(
    private _userService: UsersService,
    private _organizationService: OrganizationService,
    private _notificationService: NotificationService,
    private _emailService: EmailService,
    private _providerManager: AuthProviderManager
  ) {}
  async canRegister(provider: string) {
    if (
      process.env.DISABLE_REGISTRATION !== 'true' ||
      provider === Provider.GENERIC
    ) {
      return true;
    }

    return (await this._organizationService.getCount()) === 0;
  }

  async routeAuth(
    provider: Provider,
    body: CreateOrgUserDto | LoginUserDto,
    ip: string,
    userAgent: string,
    addToOrg?: boolean | { orgId: string; role: 'USER' | 'ADMIN'; id: string },
    lang: EmailLang = 'en'
  ) {
    if (provider === Provider.LOCAL) {
      if (body instanceof CreateOrgUserDto) {
        body.email = body.email.toLowerCase();

        const domain = body.email.split('@')[1];
        if (domain && disposableDomains.includes(domain)) {
          throw new Error('Temporary email addresses are not allowed');
        }

        const normalized = normalizeEmail(body.email);
        const existingNormalized = await this._userService.getUserByNormalizedEmail(normalized);
        if (existingNormalized) {
          throw new Error('Email already exists');
        }

        if (body.password && (await isPwnedPassword(body.password))) {
          throw new Error(PWNED_PASSWORD_MESSAGE);
        }
      }
      const user = await this._userService.getUserByEmail(body.email);
      if (body instanceof CreateOrgUserDto) {
        if (user) {
          throw new Error('Email already exists');
        }

        if (!(await this.canRegister(provider))) {
          throw new Error('Registration is disabled');
        }

        const create = await this._organizationService.createOrgAndUser(
          body,
          ip,
          userAgent
        );

        const addedOrg =
          addToOrg && typeof addToOrg !== 'boolean'
            ? await this._organizationService.addUserToOrg(
                create.users[0].user.id,
                addToOrg.id,
                addToOrg.orgId,
                addToOrg.role
              )
            : false;

        const obj = { addedOrg, jwt: await this.jwt(create.users[0].user) };
        const activation = authEmails.activation[lang];
        await this._emailService.sendEmail(
          body.email,
          activation.subject,
          activation.html(
            `${process.env.FRONTEND_URL}/auth/activate/${obj.jwt}`
          ),
          'top'
        );
        return obj;
      }

      const failuresKey = `login_failures:${body.email.toLowerCase()}`;
      const failures = Number((await ioRedis.get(failuresKey)) || 0);
      if (failures >= MAX_LOGIN_FAILURES) {
        throw new Error(
          'Too many failed login attempts. Please try again in a few minutes.'
        );
      }

      if (!user || !AuthChecker.comparePassword(body.password, user.password)) {
        const total = await ioRedis.incr(failuresKey);
        if (total === 1) {
          await ioRedis.expire(failuresKey, LOGIN_LOCKOUT_WINDOW_SECONDS);
        }
        throw new Error('Invalid user name or password');
      }

      if (!user.activated) {
        throw new Error('User is not activated');
      }

      await ioRedis.del(failuresKey);
      return { addedOrg: false, jwt: await this.jwt(user) };
    }

    const user = await this.loginOrRegisterProvider(
      provider,
      body as CreateOrgUserDto,
      ip,
      userAgent
    );

    const addedOrg =
      addToOrg && typeof addToOrg !== 'boolean'
        ? await this._organizationService.addUserToOrg(
            user.id,
            addToOrg.id,
            addToOrg.orgId,
            addToOrg.role
          )
        : false;
    return { addedOrg, jwt: await this.jwt(user) };
  }

  public getOrgFromCookie(cookie?: string) {
    if (!cookie) {
      return false;
    }

    try {
      const getOrg: any = AuthChecker.verifyJWT(cookie);
      if (dayjs(getOrg.timeLimit).isBefore(dayjs())) {
        return false;
      }

      return getOrg as {
        email: string;
        role: 'USER' | 'ADMIN';
        orgId: string;
        id: string;
      };
    } catch (err) {
      return false;
    }
  }

  private async loginOrRegisterProvider(
    provider: Provider,
    body: CreateOrgUserDto,
    ip: string,
    userAgent: string
  ) {
    const providerInstance = this._providerManager.getProvider(provider);
    const providerUser = await providerInstance.getUser(body.providerToken);

    if (!providerUser) {
      throw new Error('Invalid provider token');
    }

    const user = await this._userService.getUserByProvider(
      providerUser.id,
      provider
    );
    if (user) {
      return user;
    }

    if (!(await this.canRegister(provider))) {
      throw new Error('Registration is disabled');
    }

    const create = await this._organizationService.createOrgAndUser(
      {
        company: body.company,
        email: providerUser.email,
        password: '',
        provider,
        providerId: providerUser.id,
        termsAccepted: body.termsAccepted,
        datafast_visitor_id: body.datafast_visitor_id,
        region: body.region,
      },
      ip,
      userAgent
    );

    this._track('register', providerUser.email, body.datafast_visitor_id).catch(
      (err) => {}
    );

    try {
      if (providerInstance?.postRegistration) {
        await providerInstance.postRegistration(body.providerToken, create.id);
      }
    } catch (err) {
      // Don't fail registration if postRegistration fails
    }

    return create.users[0].user;
  }

  private async _track(
    name: string,
    email: string,
    datafast_visitor_id: string
  ) {
    if (email && datafast_visitor_id && process.env.DATAFAST_API_KEY) {
      try {
        await fetch('https://datafa.st/api/v1/goals', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.DATAFAST_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            datafast_visitor_id: datafast_visitor_id,
            name: name,
            metadata: {
              email,
            },
          }),
        });
      } catch (err) {}
    }
  }

  async forgot(email: string, lang: EmailLang = 'en') {
    const user = await this._userService.getUserByEmail(email);
    if (!user || user.providerName !== Provider.LOCAL) {
      return false;
    }

    // `tokenVersion` makes the link single-use without storing anything:
    // updatePassword increments it, so the same link stops verifying the moment
    // it is redeemed. Without this the token was a bare {id, expires} JWT that
    // nothing could mark as spent, and a leaked link stayed usable for the full
    // twenty minutes — including *after* the victim had reset their own
    // password, which handed the account to whoever else held the link.
    const resetValues = AuthChecker.signJWT({
      id: user.id,
      tokenVersion: user.tokenVersion,
      expires: dayjs().add(20, 'minutes').format('YYYY-MM-DD HH:mm:ss'),
    });

    const reset = authEmails.resetPassword[lang];
    await this._notificationService.sendEmail(
      user.email,
      reset.subject,
      reset.html(`${process.env.FRONTEND_URL}/auth/forgot/${resetValues}`)
    );
  }

  async forgotReturn(body: ForgotReturnPasswordDto) {
    const user = AuthChecker.verifyJWT(body.token) as {
      id: string;
      tokenVersion?: number;
      expires: string;
    };
    if (dayjs(user.expires).isBefore(dayjs())) {
      return false;
    }

    // Single-use check. A token minted before this change carries no
    // tokenVersion, and those are refused rather than trusted: they live at
    // most twenty minutes and a deploy takes longer than that, so failing
    // closed costs nothing and avoids leaving the old reusable shape valid.
    const current = await this._userService.getUserById(user.id);
    if (
      !current ||
      typeof user.tokenVersion !== 'number' ||
      current.tokenVersion !== user.tokenVersion
    ) {
      return false;
    }

    if (await isPwnedPassword(body.password)) {
      throw new Error(PWNED_PASSWORD_MESSAGE);
    }

    const updated = await this._userService.updatePassword(
      user.id,
      body.password
    );
    // updatePassword bumped tokenVersion; drop the cached auth context so the
    // new version is enforced on the very next request (not up to 30s later).
    await bustAuthContextCache(user.id);
    return updated;
  }

  async activate(code: string, tracking: string) {
    // A mangled activation code must read as "this link is not valid", not as
    // a server error. verifyJWT throws on a bad signature, and mail clients do
    // mangle links — wrapping, tracking rewrites — so this is a real person
    // meeting a 500 instead of being told to request a new one
    // (e2e/bugs.md E2E-03-03). getOrgFromCookie in this same file already
    // handles the same call this way.
    let user: { id: string; activated: boolean; email: string };
    try {
      user = AuthChecker.verifyJWT(code) as {
        id: string;
        activated: boolean;
        email: string;
      };
    } catch (err) {
      return false;
    }
    if (user.id && !user.activated) {
      const getUserAgain = await this._userService.getUserByEmail(user.email);
      if (getUserAgain.activated) {
        return false;
      }
      await this._userService.activateUser(user.id);
      this._track('register', user.email, tracking).catch((err) => {});
      // No newsletter auto-enroll: marketing email needs its own opt-in
      // consent (UK GDPR/PECR) — registration alone is not that consent.
      // Sign the DB user, not the decoded activation token — the decoded
      // payload carries exp/iat and jsonwebtoken refuses to re-sign it
      // with expiresIn (every activation 500ed since signJWT got a TTL).
      return this.jwt({ ...getUserAgain, activated: true });
    }

    return false;
  }

  async resendActivationEmail(email: string, lang: EmailLang = 'en') {
    const user = await this._userService.getUserByEmail(email);

    if (!user) {
      throw new Error('User not found');
    }

    if (user.activated) {
      throw new Error('Account is already activated');
    }

    const jwt = await this.jwt(user);

    const activation = authEmails.activation[lang];
    await this._emailService.sendEmail(
      user.email,
      activation.subject,
      activation.html(`${process.env.FRONTEND_URL}/auth/activate/${jwt}`),
      'top'
    );

    return true;
  }

  // CSRF state: random value stored in Redis at link time, consumed exactly
  // once in checkExists. The `auth-` prefix is what the frontend social
  // callback page uses to tell a login redirect from a channel-connect one.
  async oauthLink(provider: string, query?: any) {
    // Build the link before persisting the state. The old order wrote the Redis
    // key first, so every request that then failed — unknown provider, provider
    // not configured — still left a key behind for its full 10-minute TTL, one
    // per request, for anyone walking the URL.
    const providerInstance = this._providerManager.getProvider(provider);
    const state = `auth-${randomBytes(16).toString('hex')}`;
    const link = await providerInstance.generateLink(query, state);
    await ioRedis.set(`auth-state:${state}`, '1', 'EX', 600);
    return link;
  }

  async checkExists(
    provider: string,
    code: string,
    redirectUri?: string,
    state?: string
  ) {
    const stateKey = state ? `auth-state:${state}` : '';
    if (!stateKey || !(await ioRedis.get(stateKey))) {
      throw new Error('Invalid or expired state');
    }
    await ioRedis.del(stateKey);

    const providerInstance = this._providerManager.getProvider(provider);
    const token = await providerInstance.getToken(code, redirectUri);
    const user = await providerInstance.getUser(token);
    if (!user) {
      throw new Error('Invalid user');
    }
    const checkExists = await this._userService.getUserByProvider(
      user.id,
      provider as Provider
    );
    if (checkExists) {
      return { jwt: await this.jwt(checkExists) };
    }

    return { token };
  }

  private async jwt(user: User) {
    // Sign only the claims we actually need. auth.middleware re-resolves the
    // user (org, role, isSuperAdmin, activated) from the DB on every request
    // and never trusts token claims, so a fat token just meant a bigger cookie
    // and stale/leaked fields. `tokenVersion` is the revocation check (see the
    // column comment + auth.middleware).
    return AuthChecker.signJWT({
      id: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion ?? 0,
    });
  }
}
