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
import { ApiTags } from '@nestjs/swagger';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { Provider } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { pickEmailLang } from '@gitroom/backend/services/auth/auth.emails';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

// One definition for every auth cookie we set. It used to be copy-pasted per
// route, which is how /activate and /oauth/:provider/exists drifted to
// `sameSite: 'none'` — that ships the session cookie on cross-site requests,
// and since the API has no CSRF tokens, every freshly-activated user was
// CSRF-able until their next login. `lax` still covers the flows that set it:
// they are top-level navigations from our own email/OAuth redirect.
// Cookie lifetime is pinned to the JWT lifetime (30d). It used to be 365d,
// which left an expired-token cookie sitting in the browser for 11 months after
// the JWT it carried had died.
const AUTH_COOKIE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30;
const authCookieOptions = () => ({
  domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
  ...(!process.env.NOT_SECURED
    ? { secure: true, httpOnly: true, sameSite: 'lax' as const }
    : {}),
  expires: new Date(Date.now() + AUTH_COOKIE_MAX_AGE_MS),
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
  @Throttle({ default: { ttl: 86400000, limit: 3 } })
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

      response.cookie('auth', jwt, authCookieOptions());

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie(
          'showorg',
          addedOrg.organizationId,
          authCookieOptions()
        );

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
      }

      Sentry.metrics.count('new_user', 1);
      response.header('onboarding', 'true');
      response.status(200).json({
        register: true,
        // Klient mobilny nie odczyta httpOnly cookie — zwróć token w body.
        ...(req.headers['x-client'] === 'mobile'
          ? {
              token: this._authService.mobileJwt(jwt),
              org:
                typeof addedOrg !== 'boolean'
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

      const { jwt, addedOrg } = await this._authService.routeAuth(
        body.provider,
        body,
        ip,
        userAgent,
        getOrgFromCookie,
        pickEmailLang(req)
      );

      this._auditService.record({
        action: 'auth.login',
        ip,
        userAgent,
        metadata: { email: body.email, provider: body.provider },
      });

      response.cookie('auth', jwt, authCookieOptions());

      if (process.env.NOT_SECURED) {
        response.header('auth', jwt);
      }

      if (typeof addedOrg !== 'boolean' && addedOrg?.organizationId) {
        response.cookie(
          'showorg',
          addedOrg.organizationId,
          authCookieOptions()
        );

        if (process.env.NOT_SECURED) {
          response.header('showorg', addedOrg.organizationId);
        }
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
                typeof addedOrg !== 'boolean'
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
      await this._authService.forgot(body.email, pickEmailLang(req));
      return {
        forgot: true,
      };
    } catch (e) {
      return {
        forgot: false,
      };
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
  async oauthLink(@Param('provider') provider: string, @Query() query: any) {
    return this._authService.oauthLink(provider, query);
  }

  @Post('/activate')
  async activate(
    @Body('code') code: string,
    @Body('datafast_visitor_id') datafast_visitor_id: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const activate = await this._authService.activate(
      code,
      datafast_visitor_id
    );
    if (!activate) {
      return response.status(200).json({ can: false });
    }

    response.cookie('auth', activate, authCookieOptions());

    if (process.env.NOT_SECURED) {
      response.header('auth', activate);
    }

    response.header('onboarding', 'true');

    return response.status(200).json({ can: true });
  }

  @Post('/resend-activation')
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
    @Body('code') code: string,
    @Body('redirect_uri') redirect_uri: string,
    @Body('state') state: string,
    @Param('provider') provider: string,
    @Res({ passthrough: false }) response: Response
  ) {
    const { jwt, token } = await this._authService.checkExists(
      provider,
      code,
      redirect_uri,
      state
    );

    if (token) {
      return response.json({ token });
    }

    response.cookie('auth', jwt, authCookieOptions());

    if (process.env.NOT_SECURED) {
      response.header('auth', jwt);
    }

    response.header('reload', 'true');

    response.status(200).json({
      login: true,
    });
  }
}
