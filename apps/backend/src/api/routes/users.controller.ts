import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { sign } from 'jsonwebtoken';
import { Organization, User } from '@prisma/client';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Response, Request } from 'express';
import { AuthService } from '@gitroom/backend/services/auth/auth.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';
import { channelLimitFor } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { problemReportHtml } from '@gitroom/backend/api/routes/problem.report';
import { decodeScreenshot, screenshotLink, storeScreenshot } from '@gitroom/backend/api/routes/problem.report.screenshot';
import { ProblemReportDto } from '@gitroom/nestjs-libraries/dtos/users/problem.report.dto';
import { HttpForbiddenException } from '@gitroom/nestjs-libraries/services/exception.filter';
import { RealIP } from 'nestjs-real-ip';
import { UserAgent } from '@gitroom/nestjs-libraries/user/user.agent';
import { TrackEnum } from '@gitroom/nestjs-libraries/user/track.enum';
import { TrackService } from '@gitroom/nestjs-libraries/track/track.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { MobilePushService } from '@gitroom/nestjs-libraries/database/prisma/mobile-push/mobile.push.service';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import {
  clearImpersonateCookie,
  setImpersonateCookie,
} from '@gitroom/backend/services/auth/impersonate.cookie';
import { bustAuthContextCache } from '@gitroom/backend/services/auth/auth.middleware';
import { StripeService } from '@gitroom/nestjs-libraries/services/stripe.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

@ApiTags('User')
@Controller('/user')
export class UsersController {
  constructor(
    private _subscriptionService: SubscriptionService,
    private _authService: AuthService,
    private _orgService: OrganizationService,
    private _userService: UsersService,
    private _trackService: TrackService,
    private _mobilePush: MobilePushService,
    private _auditService: AuditService,
    private _stripeService: StripeService,
    private _notificationService: NotificationService
  ) {}

  // Register/refresh an Expo push token for the Postra Mobile app.
  @Post('/push-token')
  async registerPushToken(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Body() body: { token: string; platform?: string }
  ) {
    await this._mobilePush.registerToken(
      user.id,
      organization.id,
      body.token,
      body.platform || 'unknown'
    );
    return { success: true };
  }

  @Delete('/push-token')
  async removePushToken(
    @GetUserFromRequest() user: User,
    @Body() body: { token: string }
  ) {
    await this._mobilePush.removeToken(body.token, user.id);
    return { success: true };
  }
  @Get('/agent-media-sso')
  async getAgentMediaSsoUrl(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization
  ) {
    if (!process.env.AGENT_MEDIA_SSO_KEY) {
      throw new HttpException('Agent Media SSO is not configured', 400);
    }

    const token = sign(
      { id: organization.id, displayName: organization.name },
      process.env.AGENT_MEDIA_SSO_KEY
    );

    return { url: `https://agent-media.ai/sso/${token}` };
  }

  @Get('/self')
  async getSelf(
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() organization: Organization,
    @Req() req: Request
  ) {
    if (!organization) {
      throw new HttpForbiddenException();
    }

    // Resolved state, not the presence of a cookie: an id that matches nothing
    // used to light up the banner while the session was still the admin's own.
    const impersonate = !!(req as any).impersonatedBy;
    // @ts-ignore
    return {
      ...user,
      orgId: organization.id,
      // @ts-ignore
      totalChannels: !process.env.STRIPE_PUBLISHABLE_KEY ? 10000 : channelLimitFor(organization),
      // @ts-ignore
      tier: organization?.subscription?.subscriptionTier || (!process.env.STRIPE_PUBLISHABLE_KEY ? 'ULTIMATE' : 'FREE'),
      // @ts-ignore
      role: organization?.users[0]?.role,
      // @ts-ignore
      isLifetime: !!organization?.subscription?.isLifetime,
      admin: !!user.isSuperAdmin,
      impersonate,
      isTrailing: !process.env.STRIPE_PUBLISHABLE_KEY ? false : organization?.isTrailing,
      allowTrial: organization?.allowTrial,
      streakSince: organization?.streakSince || null,
      // @ts-ignore
      publicApi: organization?.users[0]?.role === 'SUPERADMIN' || organization?.users[0]?.role === 'ADMIN' ? organization?.apiKey : '',
    };
  }

  @Get('/personal')
  async getPersonalInformation(@GetUserFromRequest() user: User) {
    return this._userService.getPersonal(user.id);
  }

  @Get('/impersonate')
  async getImpersonate(
    @GetUserFromRequest() user: User,
    @Query('name') name: string
  ) {
    if (!user.isSuperAdmin) {
      throw new ForbiddenException('Only Postra administrators can do this');
    }

    return this._userService.getImpersonateUser(name);
  }

  @Post('/impersonate')
  async setImpersonate(
    @GetUserFromRequest() user: User,
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response,
    @Req() req: Request
  ) {
    // A session that is already impersonating carries the target's
    // permissions, not the admin's — but it still has to be able to stop, and
    // the admin behind it passed the same gate to get here.
    const impersonatedBy = (req as any).impersonatedBy as string | undefined;
    if (!user.isSuperAdmin && !impersonatedBy) {
      throw new ForbiddenException('Only Postra administrators can do this');
    }

    // An empty id is "stop", not "impersonate nobody". It used to travel the
    // same path as a start: an empty cookie written for another year, and an
    // `admin.impersonate` row indistinguishable from the row that began it.
    if (!id) {
      clearImpersonateCookie(response);
      // Who stopped, so a stop pairs with its start (E2E-09-64). While
      // impersonating, `user` is the target; record() puts the admin from
      // the JWT in its place and the target beside it.
      this._auditService.record({
        action: 'admin.impersonate.stop',
        userId: user.id,
      });

      if (process.env.NOT_SECURED) {
        response.header('impersonate', '');
      }
      return { stopped: true };
    }

    // Validate before writing anything. Any id at all used to set a year-long
    // cookie; when it resolved to nothing the middleware quietly carried on as
    // the admin, while /user/self read the cookie's mere presence and showed a
    // banner saying they were impersonating themselves — for up to a year.
    const target = await this._orgService.getUserOrg(id);
    if (!target) {
      throw new HttpException('No such user organization', 404);
    }

    this._auditService.record({
      action: 'admin.impersonate',
      userId: user.id,
      organizationId: target.organization.id,
      metadata: {
        impersonatedUserOrg: id,
        impersonatedUserId: target.user.id,
      },
    });

    setImpersonateCookie(response, id);

    if (process.env.NOT_SECURED) {
      response.header('impersonate', id);
    }

    return { impersonating: target.user.email };
  }

  @Post('/personal')
  async changePersonal(
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: UserDetailDto
  ) {
    return this._userService.changePersonal(user.id, organization.id, body);
  }

  // "Report a problem" also lands in the team's inbox. Sentry keeps the report
  // and its screenshot, but sends no mail on our plan: a report sent on
  // 2026-10-03 sat in Sentry unseen. Reply-To is the reporter, so answering
  // is one click.
  @Post('/problem-report')
  @Throttle({ default: { ttl: 3600000, limit: 10 } })
  async problemReport(
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User,
    @Body() body: ProblemReportDto
  ) {
    const replyTo = body.email || user.email;
    const shot = decodeScreenshot(body.screenshot);
    const screenshotFile = shot
      ? await storeScreenshot(shot).catch((err) => {
          Logger.error(`problem-report screenshot not stored: ${err?.message}`);
          return undefined;
        })
      : undefined;
    const screenshotUrl = screenshotFile && screenshotLink(screenshotFile);
    if (body.screenshot && !shot) {
      Logger.warn(`problem-report screenshot refused (${body.screenshot.slice(0, 30)}…, ${body.screenshot.length} chars)`);
    }
    await this._notificationService.sendEmail(
      process.env.EMAIL_ADMIN_ADDRESS || process.env.EMAIL_FROM_ADDRESS!,
      // The mail template puts the subject into HTML unescaped.
      `Problem report from ${organization.name.replace(/[<>&"']/g, '')}`.slice(0, 150),
      problemReportHtml({
        message: body.message,
        name: body.name,
        email: replyTo,
        organization: organization.name,
        page: body.page,
        eventId: body.eventId,
        screenshotUrl,
        screenshotLost: !!body.screenshot && !screenshotUrl,
      }),
      replyTo
    );
    // Lets the widget test tell a kept screenshot from a dropped one.
    return {
      ok: true,
      screenshot: screenshotUrl ? 'stored' : body.screenshot ? 'lost' : 'none',
    };
  }

  @Get('/email-notifications')
  async getEmailNotifications(@GetUserFromRequest() user: User) {
    return this._userService.getEmailNotifications(user.id);
  }

  @Post('/email-notifications')
  async updateEmailNotifications(
    @GetUserFromRequest() user: User,
    @Body() body: EmailNotificationsDto
  ) {
    return this._userService.updateEmailNotifications(user.id, body);
  }

  @Post('/api-key/rotate')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async rotateApiKey(
    @GetOrgFromRequest() organization: Organization,
    @GetUserFromRequest() user: User
  ) {
    const result = await this._orgService.updateApiKey(organization.id);
    this._auditService.record({
      action: 'security.apikey.rotate',
      userId: user.id,
      organizationId: organization.id,
    });
    // The old key lives in the 30s auth-context cache — drop it so the
    // rotation takes effect immediately.
    await bustAuthContextCache(user.id);
    return result;
  }

  @Get('/subscription')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getSubscription(@GetOrgFromRequest() organization: Organization) {
    const subscription =
      await this._subscriptionService.getSubscriptionByOrganizationId(
        organization.id
      );

    return subscription ? { subscription } : { subscription: undefined };
  }

  // What an invitation is for, without accepting it: the join page asks
  // "Join X as Y?" before anything is written (E2E-08-34).
  @Get('/invite-preview')
  async invitePreview(
    @GetUserFromRequest() user: User,
    @Query('org') org: string
  ) {
    const invite = this._authService.getOrgFromCookie(org);
    if (!invite) {
      return { valid: false };
    }
    const organization = await this._orgService.getOrgById(invite.orgId);
    if (!organization) {
      return { valid: false };
    }
    return {
      valid: true,
      organization: organization.name,
      role: invite.role,
      email: user.email,
    };
  }

  @Post('/join-org')
  async joinOrg(
    @GetUserFromRequest() user: User,
    @Body('org') org: string,
    @Res({ passthrough: true }) response: Response
  ) {
    const getOrgFromCookie = this._authService.getOrgFromCookie(org);

    if (!getOrgFromCookie) {
      return response.status(200).json({ id: null });
    }

    const addedOrg = await this._orgService.addUserToOrg(
      user.id,
      getOrgFromCookie.id,
      getOrgFromCookie.orgId,
      getOrgFromCookie.role
    );

    // The user's organisations sit in the 30s auth-context cache: without
    // this, the app switched to the new organisation and landed back in the
    // old one until the cache ran out.
    await bustAuthContextCache(user.id);

    // A full team is said so (E2E-07-38); the page read a bare {id: null} as
    // "expired or already used". 200, not 402: the person joining does not
    // pay for that workspace, and 402 opens the paywall.
    if (addedOrg === 'no_seats') {
      response.status(200).json({ id: null, reason: 'no_seats' });
      return;
    }
    response.status(200).json({
      id: typeof addedOrg !== 'boolean' ? addedOrg.organizationId : null,
    });
  }

  // The list every member's browser loads for the organisation switcher. It
  // carried the API key (a SUPERADMIN credential for the public API and MCP)
  // and the Stripe customer id to every member, USER included (E2E-08-24);
  // /user/self shows the key to admins only, and nothing here needs either.
  // Only the fields the switchers read (web and mobile), so a column added to
  // Organization later does not reach every member by default (upstream
  // 8ad0df3d).
  @Get('/organizations')
  async getOrgs(@GetUserFromRequest() user: User) {
    return (await this._orgService.getOrgsByUserId(user.id))
      .filter((f) => !f.users[0].disabled)
      .map(({ id, name, users, subscription }) => ({
        id,
        name,
        users,
        subscription,
      }));
  }

  @Post('/change-org')
  changeOrg(
    @Body('id') id: string,
    @Res({ passthrough: true }) response: Response
  ) {
    response.cookie('showorg', id, {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          }
        : {}),
      expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
    });

    if (process.env.NOT_SECURED) {
      response.header('showorg', id);
    }

    response.status(200).send();
  }

  /**
   * Hand the app a fresh token for the session it already holds. Called on
   * launch, so a phone in regular use never reaches the token's expiry; one
   * left alone for longer than that asks for the password again. The session id
   * is carried over, so signing out still ends every token handed out here.
   */
  @Post('/refresh-token')
  refreshToken(@Req() request: Request) {
    const current = (request.headers.auth as string) || request.cookies?.auth;
    return { token: this._authService.refreshMobileJwt(current) };
  }

  @Post('/logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response
  ) {
    // Clearing the cookie ends the browser's session, and used to be all that
    // happened — a token in the app's Keychain kept working for the rest of its
    // 30 days. A mobile token carries a session id, and this is
    // where it stops being accepted.
    await this._authService.endMobileSession(
      (request.headers.auth as string) || request.cookies?.auth
    );

    response.header('logout', 'true');
    response.cookie('auth', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    // The impersonate cookie lives for a year — without clearing it here a
    // superadmin who logs out mid-impersonation gets re-impersonated on the
    // very next login.
    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax' as const,
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('showorg', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.cookie('impersonate', '', {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      ...(!process.env.NOT_SECURED
        ? {
            secure: true,
            httpOnly: true,
            sameSite: 'lax',
          }
        : {}),
      maxAge: -1,
      expires: new Date(0),
    });

    response.status(200).send();
  }

  // GDPR / RODO right to erasure + Meta data-deletion. Permanently deletes the
  // signed-in user and the organizations they solely own (see UsersService.
  // deleteAccount), then clears the session cookies.
  @Post('/delete')
  @Throttle({ default: { ttl: 3_600_000, limit: 5 } })
  async deleteSelf(
    @GetUserFromRequest() user: User,
    @Res({ passthrough: true }) response: Response
  ) {
    // Cancel Stripe billing before the DB rows (and with them the customer
    // lookup) are gone. Orchestrated here because StripeService itself injects
    // UsersService — the reverse dependency would be circular.
    const soleOrgIds = await this._userService.getSoleOwnedOrganizations(
      user.id
    );
    for (const organizationId of soleOrgIds) {
      await this._stripeService.cancelAllSubscriptionsForDeletedAccount(
        organizationId
      );
    }

    await this._userService.deleteAccount(user.id);
    // Another device signed in as this user kept reading the shared org for
    // up to the 30 s the auth context is cached (AUTH-8).
    await bustAuthContextCache(user.id);

    // GDPR art. 12: confirm the erasure to the data subject, in writing.
    // Best-effort — the deletion already happened and must not fail on email.
    try {
      await this._notificationService.sendEmail(
        user.email,
        'Your Postra account has been deleted',
        'Your Postra account and its data — connected channels, scheduled posts and media — have been permanently deleted, and any active subscription was cancelled. Billing records required by law are retained in line with our privacy policy. Thanks for trying Postra.'
      );
    } catch (e) {
      /* the account is gone either way */
    }

    response.header('logout', 'true');
    for (const name of ['auth', 'showorg', 'impersonate']) {
      response.cookie(name, '', {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
            }
          : {}),
        maxAge: -1,
        expires: new Date(0),
      });
    }

    response.status(200).json({ deleted: true });
  }

  @Post('/t')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  async trackEvent(
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
    @GetUserFromRequest() user: User,
    @RealIP() ip: string,
    @UserAgent() userAgent: string,
    @Body()
    body: { tt: TrackEnum; fbclid: string; additional: Record<string, any> }
  ) {
    const uniqueId = req?.cookies?.track || makeId(10);
    const fbclid = req?.cookies?.fbclid || body.fbclid;
    await this._trackService.track(
      uniqueId,
      ip,
      userAgent,
      body.tt,
      body.additional,
      fbclid,
      user
    );
    if (!req.cookies.track) {
      res.cookie('track', uniqueId, {
        domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
        ...(!process.env.NOT_SECURED
          ? {
              secure: true,
              httpOnly: true,
              sameSite: 'lax',
            }
          : {}),
        expires: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
      });
    }

    res.status(200).json({
      track: uniqueId,
    });
  }
}
