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
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response, Request } from 'express';

import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { LoginUserDto } from '@gitroom/nestjs-libraries/dtos/auth/login.user.dto';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { ForgotReturnPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot-return.password.dto';
import { ForgotPasswordDto } from '@gitroom/nestjs-libraries/dtos/auth/forgot.password.dto';
import { ResendActivationDto } from '@gitroom/nestjs-libraries/dtos/auth/resend-activation.dto';
import { GoogleNativeLoginDto } from '@gitroom/nestjs-libraries/dtos/auth/google-native.dto';
import { ApiTags } from '@nestjs/swagger';
import {
  authCookieOptions,
  setSessionCookie,
} from '@gitroom/backend/services/auth/session.cookie';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { pickEmailLang } from '@gitroom/backend/services/auth/auth.emails';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

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

@ApiTags('Auth')
@Controller('/auth')
export class AuthController {
  constructor(
    private _authService: AuthService,
    private _emailService: EmailService,
    private _auditService: AuditService
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

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        pickEmailLang(req)
      );

      this._auditService.record({
        action: 'auth.register',
        ip,
        userAgent,
        metadata: { email: body.email, provider: body.provider },
      });

      const activationRequired =
        body.provider === 'LOCAL' && this._emailService.hasProvider();

      if (activationRequired) {
        response.header('activate', 'true');
        response.status(200).json({ activate: true });
        return;
      }

      setSessionCookie(response, jwt);

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg === 'object' && addedOrg?.organizationId) {
        response.cookie(
          'showorg',
          addedOrg.organizationId,
          authCookieOptions()
        );

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
        ...(req.headers['x-client'] === 'mobile'
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
        metadata: { email: body.email, provider: body.provider },
      });

      setSessionCookie(response, jwt);

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg === 'object' && addedOrg?.organizationId) {
        response.cookie(
          'showorg',
          addedOrg.organizationId,
          authCookieOptions()
        );

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
        ...(req.headers['x-client'] === 'mobile'
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
      metadata: { email: result.user.email, provider: 'GOOGLE', via: 'mobile' },
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
    @Res({ passthrough: false }) response: Response
  ) {
    let activate: string | false;
    try {
      activate = await this._authService.activate(code, datafast_visitor_id);
    } catch (e: any) {
      // The page shows "invalid or expired" for any non-2xx; `can: false`
      // stays for a link that was already used.
      return response.status(400).type('text/plain').send(e.message);
    }
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    // The page posts on open, so someone else's activation link signed the
    // browser out of its own account and into theirs. A browser
    // that is already signed in keeps its session; the account is activated.
    if (req.cookies?.auth || req.headers.auth) {
      return response.status(200).json({ can: true, kept: true });
    }

    setSessionCookie(response, activate);

    if (process.env.NOT_SECURED) {
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
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
    let result: { jwt?: string; token?: string; canRegister?: boolean };
    const { maxAge: _maxAge, ...cookieScope } = oauthStateCookieOptions();
    response.clearCookie(OAUTH_STATE_COOKIE, cookieScope);
    try {
      result = await this._authService.checkExists(
        provider,
        code,
        redirect_uri,
        state,
        req.cookies?.[OAUTH_STATE_COOKIE]
      );
    } catch (e: any) {
      const message =
        e?.message === 'Invalid or expired state'
          ? e.message
          : 'Sign-in with this provider failed. Please try again.';
      return response.status(400).type('text/plain').send(message);
    }
    const { jwt, token, canRegister } = result;

    if (token) {
      return response.json({ token, canRegister });
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
