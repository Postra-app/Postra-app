import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import {
  ACTIVATION_LINK_INVALID,
  ACTIVATION_WRONG_PASSWORD,
  AuthService,
  LOGIN_LOCKED_OUT,
  REGISTRATION_PROOF_TTL_SECONDS,
} from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@gitroom/nestjs-libraries/dtos/auth/resend-activation.dto';
import { GoogleNativeLoginDto } from '@gitroom/nestjs-libraries/dtos/auth/google-native.dto';
import { ApiTags } from '@nestjs/swagger';
import {
  authCookieOptions,
  setSessionCookie,
} from '@gitroom/backend/services/auth/session.cookie';
import {
  clearSessionCookies,
  sessionCookieOptions,
} from '@gitroom/nestjs-libraries/services/auth/remove.auth';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { pickEmailLang } from '@gitroom/backend/services/auth/auth.emails';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import {
  AccountDeletionService,
  DELETE_LINK_INVALID,
} from '@gitroom/backend/services/auth/account.deletion.service';
import { AuthService as AuthChecker } from '@gitroom/helpers/auth/auth.service';
import { SignupSource } from '@gitroom/helpers/utils/signup.source';

// The invitation an `/auth?org=…` link left behind (frontend proxy.ts), with
// the attributes it was set with.
const orgCookieClearOptions = () => ({ path: '/' });

// Ties a sign-in with Google/GitHub/… to the browser that started it; see
// AuthService.oauthLink.
const OAUTH_STATE_COOKIE = 'postra_oauth';
// Nothing in the page reads it, so it is HttpOnly in every mode; only
// `secure` waits for HTTPS (NOT_SECURED is plain-http local development).
const oauthStateCookieOptions = () => ({
  path: '/',
  maxAge: 600 * 1000,
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: !process.env.NOT_SECURED,
});

// The native app names itself; it gets its token in the body.
const REGISTRATION_PROOF_COOKIE = 'postra_reg';

const isAppClient = (req: Request) => req.headers?.['x-client'] === 'mobile';

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService,
    private _auditService: AuditService,
    private _accountDeletion: AccountDeletionService
  ) {}

  @Get('/can-register')
  async canRegister() {
    return {
      register: await this._authService.canRegister(Provider.LOCAL as string),
    };
  }

  @Post('/register')
  // 4 sign-ups per IP per day: 3 cut off a household or office trying again
  // after a typo.
  @Throttle({ default: { ttl: 86400000, limit: 4 } })
  async register(
    @Req() req: Request,
    @Body() body: CreateOrgUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const signedUp = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        pickEmailLang(req)
      );
      const { jwt, addedOrg } = signedUp;
      const registrationProof =
        'registrationProof' in signedUp ? signedUp.registrationProof : undefined;

      // Named by user and organisation, not by address: the audit view
      // resolves the id while the account exists, and nothing personal stays
      // in the row once the account is deleted.
      this._auditService.record({
        action: 'auth.register',
        userId: signedUp.userId,
        organizationId:
          'organizationId' in signedUp ? signedUp.organizationId : undefined,
        ip,
        userAgent,
        metadata: { provider: body.provider },
      });

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        // Marks this browser as the one the password was typed in; see
        // AuthService.activate.
        if (registrationProof) {
          response.cookie(REGISTRATION_PROOF_COOKIE, registrationProof, {
            ...sessionCookieOptions(),
            maxAge: REGISTRATION_PROOF_TTL_SECONDS * 1000,
          });
        }
        // The invitation is already used (the membership exists): the
        // browser that activates must not be asked to join again.
        if (typeof addedOrg === 'object' && addedOrg?.organizationId) {
          response.clearCookie('org', orgCookieClearOptions());
        }
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      // The app keeps its own short token in the Keychain and never sends
      // cookies on purpose; the 30-day web cookie it used to get here sat in
      // the phone's cookie store, outside the Keychain and untouched by the
      // app's sign-out. No cookie for the app, and the ones older versions
      // were given are expired.
      const forApp = isAppClient(req);
      if (forApp) {
        clearSessionCookies(response, ['auth', 'showorg']);
      } else {
        setSessionCookie(response, jwt);
      }

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg === 'object' && addedOrg?.organizationId) {
        if (!forApp) {
          response.cookie(
            'showorg',
            addedOrg.organizationId,
            authCookieOptions()
          );
        }

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
        // Used: the app would otherwise ask on /join to accept it again.
        response.clearCookie('org', orgCookieClearOptions());
      }

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
        // The mobile client cannot read an httpOnly cookie — return the token in the body.
        ...(forApp
          ? {
              token: this._authService.mobileJwt(jwt),
              org:
                typeof addedOrg === 'object'
                  ? addedOrg?.organizationId
                  : undefined,
            }
          : {}),
      });
    } catch (e: any) {
      // Force text/plain: Express's res.send(string) would set text/html, which
      // makes CodeQL flag this as reflected XSS / exception-text-as-HTML even
      // though the message is server-generated. text/plain keeps the browser
      // from ever rendering it as markup, and the client reads it via .text().
      response.status(400).type('text/plain').send(e.message);
    }
  }

  @Post('/login')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  async login(
    @Req() req: Request,
    @Body() body: LoginUserDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    try {
      const getOrgFromCookie = this._authService.getOrgFromCookie(
        req?.cookies?.org
      );

      const { jwt, addedOrg, userId } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        pickEmailLang(req)
      );

      // Signing in runs before there is a session: name the person here.
      this._auditService.record({
        action: 'auth.login',
        userId,
        ip,
        userAgent,
        metadata: { provider: body.provider },
      });

      // The app keeps its own short token in the Keychain and never sends
      // cookies on purpose; the 30-day web cookie it used to get here sat in
      // the phone's cookie store, outside the Keychain and untouched by the
      // app's sign-out. No cookie for the app, and the ones older versions
      // were given are expired.
      const forApp = isAppClient(req);
      if (forApp) {
        clearSessionCookies(response, ['auth', 'showorg']);
      } else {
        setSessionCookie(response, jwt);
      }

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg === 'object' && addedOrg?.organizationId) {
        if (!forApp) {
          response.cookie(
            'showorg',
            addedOrg.organizationId,
            authCookieOptions()
          );
        }

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
        // Used: the app would otherwise ask on /join to accept it again.
        response.clearCookie('org', orgCookieClearOptions());
      }

      response.header('reload', 'true');
      response.status(200).json({
        login: true,
        // The native client cannot read an httpOnly cookie, so it gets the
        // token in the body — but not the same one. The app's token is short
        // and revocable; see AuthService.mobileJwt.
        ...(forApp
          ? {
              token: this._authService.mobileJwt(jwt),
              org:
                typeof addedOrg === 'object'
                  ? addedOrg?.organizationId
                  : undefined,
            }
          : {}),
      });
    } catch (e: any) {
      // No account to name: the address typed is the only way to see one
      // account being guessed at. It leaves these rows when the account it
      // belongs to is deleted (UsersService.deleteAccount).
      this._auditService.record({
        action: 'auth.login.failed',
        ip,
        userAgent,
        metadata: { email: body.email, reason: e.message?.slice(0, 200) },
      });
      // Force text/plain: Express's res.send(string) would set text/html, which
      // makes CodeQL flag this as reflected XSS / exception-text-as-HTML even
      // though the message is server-generated. text/plain keeps the browser
      // from ever rendering it as markup, and the client reads it via .text().
      response.status(400).type('text/plain').send(e.message);
    }
  }

  @Post('/forgot')
  @Throttle({ default: { ttl: 900000, limit: 3 } })
  async forgot(@Req() req: Request, @Body() body: ForgotPasswordDto) {
    try {
      return await this._authService.forgot(body.email, pickEmailLang(req));
    } catch (e) {
      return { forgot: false, reason: 'send_failed' };
    }
  }

  @Post('/forgot-return')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  async forgotReturn(@Body() body: ForgotReturnPasswordDto) {
    try {
      const reset = await this._authService.forgotReturn(body);
      if (reset) {
        this._auditService.record({ action: 'auth.password.reset' });
      }
      return {
        reset: !!reset,
      };
    } catch (e: any) {
      throw new HttpException(e.message, 400);
    }
  }

  // The link from the "Confirm deleting your Postra account" email. The page
  // posts only when the person presses the button, never on load, so a mail
  // scanner opening the link deletes nothing. No session needed: the link
  // went to the address, and a Google or Apple account on the phone may have
  // no web session to open it in.
  @Post('/delete-account')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  async deleteAccount(
    @Req() req: Request,
    @Body('token') token: unknown,
    @Res({ passthrough: true }) response: Response
  ) {
    const deletedId = await this._accountDeletion.confirm(token);
    if (!deletedId) {
      throw new HttpException(DELETE_LINK_INVALID, 400);
    }
    // Sign out this browser only if it was the deleted account's session;
    // someone else's link opened in my browser must not sign me out.
    try {
      const session = req.cookies?.auth
        ? (AuthChecker.verifyJWT(req.cookies.auth) as { id?: string })
        : undefined;
      if (session?.id === deletedId) {
        response.header('logout', 'true');
        clearSessionCookies(response);
      }
    } catch {
      /* not a session of the deleted account */
    }
    return { deleted: true };
  }

  // Sign-in with Google in the mobile app: the native sign-in on the phone
  // returns an ID token, this checks it with Google and answers like /login
  // does for `x-client: mobile` — the app's short, revocable token in the
  // body. Existing accounts only (AuthService.googleNativeLogin). The app
  // tells 404 (no account: sign up on the web) and 409 (the address has an
  // account with a password: sign in with it) from 400 (try again).
  @Post('/google/native')
  @Throttle({ default: { ttl: 900000, limit: 10 } })
  async googleNative(
    @Body() body: GoogleNativeLoginDto,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    let result: Awaited<ReturnType<AuthService['googleNativeLogin']>>;
    try {
      result = await this._authService.googleNativeLogin(body.idToken);
    } catch (e: any) {
      // A suspended account: the same message /login gives.
      this._auditService.record({
        action: 'auth.login.failed',
        ip,
        userAgent,
        metadata: { provider: 'GOOGLE', via: 'mobile', reason: e?.message?.slice(0, 200) },
      });
      return response.status(400).type('text/plain').send(e?.message);
    }

    if ('error' in result) {
      this._auditService.record({
        action: 'auth.login.failed',
        ip,
        userAgent,
        metadata: { provider: 'GOOGLE', via: 'mobile', reason: result.error },
      });
      if (result.error === 'password_account') {
        return response
          .status(409)
          .type('text/plain')
          .send('This email has a Postra account with a password.');
      }
      return result.error === 'no_account'
        ? response
            .status(404)
            .type('text/plain')
            .send('No Postra account uses this Google account.')
        : response
            .status(400)
            .type('text/plain')
            .send('Google sign-in failed. Please try again.');
    }

    this._auditService.record({
      action: 'auth.login',
      userId: result.user.id,
      ip,
      userAgent,
      metadata: { provider: 'GOOGLE', via: 'mobile' },
    });
    return response.status(200).json({
      login: true,
      token: this._authService.mobileJwt(result.jwt),
    });
  }

  @Get('/oauth-mobile-callback')
  mobileCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const scheme = process.env.MOBILE_APP_SCHEME || 'postra://auth/callback';
    const params = new URLSearchParams();
    if (code) params.set('code', code);
    if (state) params.set('state', state);
    return response.redirect(302, `${scheme}?${params.toString()}`);
  }

  @Get('/oauth/:provider')
  async oauthLink(
    @Param('provider') provider: string,
    @Query() query: any,
    @Res({ passthrough: true }) response: Response
  ) {
    const { link, nonce } = await this._authService.oauthLink(provider, query);
    response.cookie(OAUTH_STATE_COOKIE, nonce, oauthStateCookieOptions());
    return link;
  }

  @Post('/activate')
  async activate(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip?: string,
    @UserAgent() userAgent?: string
  ) {
    let activate: Awaited<ReturnType<AuthService['activate']>>;
    try {
      activate = await this._authService.activate(
        code,
        datafast_visitor_id,
        req.cookies?.[REGISTRATION_PROOF_COOKIE]
      );
    } catch (e: any) {
      // The page shows "invalid or expired" for any non-2xx; `can: false`
      // stays for a link that was already used. The answer is that sentence
      // and nothing else: an exception from the database or Redis named
      // hosts and queries to whoever opened a link.
      if (e?.message !== ACTIVATION_LINK_INVALID) {
        Logger.error(`activation failed: ${e?.message}`);
      }
      return response.status(400).type('text/plain').send(ACTIVATION_LINK_INVALID);
    }
    if (!activate) {
      return response.status(200).json({ can: false });
    }
    response.clearCookie(REGISTRATION_PROOF_COOKIE, sessionCookieOptions());

    // Opened somewhere other than the browser that signed up: nothing is
    // activated yet. The page asks for the password chosen at sign-up
    // (/activate/sign-in), or offers to choose a new one (/activate/reset).
    if (typeof activate !== 'string') {
      return response
        .status(200)
        .json({ can: true, signIn: true, email: activate.signIn });
    }

    // The page posts on open, so someone else's activation link signed the
    // browser out of its own account and into theirs. A browser
    // that is already signed in keeps its session; the account is activated.
    if (req.cookies?.auth || req.headers.auth) {
      return response.status(200).json({ can: true, kept: true });
    }

    setSessionCookie(response, activate);
    // The browser that signed up is signed in here: the account's first
    // sign-in, which the audit used to miss.
    this._auditService.record({
      action: 'auth.login',
      userId: (AuthChecker.verifyJWT(activate) as { id?: string })?.id,
      ip,
      userAgent,
      metadata: { provider: 'LOCAL', via: 'activation-link' },
    });

    if (process.env.NOT_SECURED) {
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  // The activation link opened in another browser, with the password chosen
  // at sign-up: activates and signs this browser in. Throttled as signing in.
  @Post('/activate/sign-in')
  @Throttle({ default: { ttl: 900000, limit: 5 } })
  async activateSignIn(
    @Body('code') code: string,
    @Body('password') password: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response,
    @RealIP() ip: string,
    @UserAgent() userAgent: string
  ) {
    let jwt: string | false;
    try {
      jwt = await this._authService.activateWithPassword(
        code,
        password,
        datafast_visitor_id
      );
    } catch (e: any) {
      const message = String(e?.message || '');
      if (message === ACTIVATION_WRONG_PASSWORD) {
        this._auditService.record({
          action: 'auth.login.failed',
          ip,
          userAgent,
          metadata: { via: 'activation', reason: 'wrong_password' },
        });
        return response
          .status(400)
          .type('text/plain')
          .send(ACTIVATION_WRONG_PASSWORD);
      }
      if (message === LOGIN_LOCKED_OUT) {
        return response.status(429).type('text/plain').send(LOGIN_LOCKED_OUT);
      }
      if (message !== ACTIVATION_LINK_INVALID) {
        Logger.error(`activation sign-in failed: ${message}`);
      }
      return response.status(400).type('text/plain').send(ACTIVATION_LINK_INVALID);
    }
    if (!jwt) {
      return response.status(200).json({ can: false });
    }
    response.clearCookie(REGISTRATION_PROOF_COOKIE, sessionCookieOptions());
    const userId = (AuthChecker.verifyJWT(jwt) as { id?: string })?.id;
    this._auditService.record({
      action: 'auth.login',
      userId,
      ip,
      userAgent,
      metadata: { provider: 'LOCAL', via: 'activation' },
    });
    // A browser signed in to another account was asked to switch by typing
    // this account's password: its organisation choice goes with it.
    clearSessionCookies(response, ['showorg']);
    setSessionCookie(response, jwt);
    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }
    response.header('onboarding', 'true');
    return response.status(200).json({ can: true });
  }

  // The activation link opened by someone who did not sign up, or does not
  // remember the password: the account is activated without that password
  // and the page sends the holder of the link to choose theirs.
  @Post('/activate/reset')
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  async activateReset(
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    let result: Awaited<ReturnType<AuthService['activateAndChoosePassword']>>;
    try {
      result = await this._authService.activateAndChoosePassword(
        code,
        datafast_visitor_id
      );
    } catch (e: any) {
      if (e?.message !== ACTIVATION_LINK_INVALID) {
        Logger.error(`activation reset failed: ${e?.message}`);
      }
      return response.status(400).type('text/plain').send(ACTIVATION_LINK_INVALID);
    }
    if (!result) {
      return response.status(200).json({ can: false });
    }
    response.clearCookie(REGISTRATION_PROOF_COOKIE, sessionCookieOptions());
    return response
      .status(200)
      .json({ can: true, setPassword: result.setPassword });
  }

  @Post('/resend-activation')
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  async resendActivation(
    @Req() req: Request,
    @Body() body: ResendActivationDto
  ) {
    try {
      await this._authService.resendActivationEmail(
        body.email,
        pickEmailLang(req)
      );
      return {
        success: true,
      };
    } catch (e: any) {
      return {
        success: false,
        message: e.message,
        // The page says it in the reader's language.
        ...(e?.reason === 'undeliverable' ? { reason: 'undeliverable' } : {}),
      };
    }
  }

  @Post('/oauth/:provider/exists')
  async oauthExists(
    @Req() req: Request,
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Body('state') state: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    // A spent or forged state, or a code the provider refuses, is the
    // caller's problem: it was a 500 (and a Sentry issue) every time.
    let result: {
      jwt?: string;
      token?: string;
      canRegister?: boolean;
      signup?: SignupSource;
      email?: string;
      passwordAccount?: true;
    };
    const { maxAge: _maxAge, ...cookieScope } = oauthStateCookieOptions();
    response.clearCookie(OAUTH_STATE_COOKIE, cookieScope);
    try {
      result = await this._authService.checkExists(
        provider,
        code,
        redirect_uri,
        state,
        req.cookies?.[OAUTH_STATE_COOKIE],
        // An invitation to a team waiting in this browser: its address may
        // sign up while sign-ups are closed.
        this._authService.getOrgFromCookie(req.cookies?.org)
      );
    } catch (e: any) {
      const message =
        e?.message === 'Invalid or expired state'
          ? e.message
          : 'Sign-in with this provider failed. Please try again.';
      return response.status(400).type('text/plain').send(message);
    }
    const { jwt, token, canRegister, signup, email } = result;

    if (result.passwordAccount) {
      return response.json({ passwordAccount: true });
    }

    if (token) {
      return response.json({ token, canRegister, signup, email });
    }

    setSessionCookie(response, jwt);

    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }
}
