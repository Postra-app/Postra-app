import {
  Body,
  Controller,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseFilters,
} from '@nestjs/common';
import { Request } from 'express';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { ConnectIntegrationDto } from '@gitroom/nestjs-libraries/dtos/integrations/connect.integration.dto';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { NotEnoughScopesFilter } from '@gitroom/nestjs-libraries/integrations/integration.missing.scopes';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { AuthTokenDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { NotEnoughScopes } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import {
  channelLimitFor,
  pricing,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The native app's URL scheme, registered in Postra-mobile's app.json. The
// callback page is allowed to hand an OAuth return back to this scheme and no
// other.
const APP_SCHEME = 'postra';

@ApiTags('Integrations')
@Controller('/integrations')
export class NoAuthIntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _organizationService: OrganizationService,
    private _subscriptionService: SubscriptionService
  ) {}

  @Get('/')
  getIntegrations() {
    return this._integrationManager.getAllIntegrations();
  }

  /**
   * Resolves an invite token to the provider URL it stands for. Necessarily
   * public: the person following an invite link is a client of the customer,
   * has no Postra account and no session. The token carries no organisation
   * data — that binding lives in the OAuth state inside the stored URL — and
   * expires with the invite after an hour.
   */
  @Get('/invite/:token')
  async getInviteUrl(@Param('token') token: string) {
    const url = await ioRedis.get(`invite:${token}`);
    if (!url) {
      return { err: true };
    }

    return { url };
  }

  /**
   * Tells the OAuth callback page whether this flow was started by the native
   * app, and where to hand it back.
   *
   * ⛔ Why this exists (E2E-10-70). The provider always redirects the *browser*
   * to `app.postra.pl/integrations/social/:provider`, and that page then calls
   * `POST /social-connect/:provider`. On a phone the browser has no Postra
   * session — the app signs in with a token in secure storage, not a cookie —
   * so the callback hit the session gate below and answered
   * `401 "You must be signed in to connect a channel"`. The gate is correct and
   * must not be relaxed: without it an attacker mints a `state` for their own
   * org and has a victim's channel connected into it. What was missing is a way
   * for the app to finish the exchange itself, with the token it already holds.
   *
   * So the page asks here first. For a browser-started flow nothing changes.
   * For an app-started one it bounces `state` and `code` back over the app's
   * own scheme and stops — the app then POSTs the callback with its `auth`
   * header and passes the same gate legitimately.
   *
   * Public by necessity (the browser has no session) and deliberately thin: it
   * reads one Redis key, consumes nothing, and answers about a value the app
   * supplied itself. `state` stays single-use — this route does not spend it.
   */
  @Get('/social-connect/:integration/handoff')
  async getConnectHandoff(@Query('state') state: string) {
    const noHandoff = { handoff: false };
    if (!state) {
      return noHandoff;
    }

    const redirectUrl = await ioRedis.get(`redirect:${state}`);
    if (!redirectUrl) {
      return noHandoff;
    }

    // Only ever hand off to our own app. `redirectUrl` arrives from an
    // authenticated caller, so it cannot be aimed at someone else's account —
    // but an allowlist keeps the callback page from being turned into a
    // redirector for any scheme a caller can think of.
    if (!redirectUrl.startsWith(`${APP_SCHEME}://`)) {
      return noHandoff;
    }

    return { handoff: true, url: redirectUrl };
  }

  @Post('/social-connect/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @UseFilters(new NotEnoughScopesFilter())
  async connectSocialMedia(
    @Param('integration') integration: string,
    @Body() body: ConnectIntegrationDto,
    @Req() req: Request
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new Error('Integration not allowed');
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    const getCodeVerifier = integrationProvider.customFields
      ? 'none'
      : await ioRedis.get(`login:${body.state}`);
    // The state key is single-use (deleted below before authenticate), so a
    // refresh/re-POST of the callback lands here — a clean 400, not a 500.
    if (!getCodeVerifier) {
      throw new HttpException(
        'This connection attempt has expired. Please start adding the channel again.',
        400
      );
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new HttpException(
        'This connection attempt has expired. Please start adding the channel again.',
        400
      );
    }

    // SECURITY: this route is unauthenticated by design (the OAuth provider
    // redirects the browser here), so the target org comes from Redis keyed by
    // `state`. Without binding the callback to the completing session, an
    // attacker could mint a `state` for their own org, send the provider's
    // authorize URL to a victim, and have the victim's channel connected into
    // the attacker's org (login-CSRF / channel hijack). Require an authenticated
    // session and verify it is a member of the org the channel connects to —
    // the victim is not a member of the attacker's org, so the flow is rejected.
    const authToken = (req.headers.auth as string) || req.cookies?.auth;
    let sessionUser: { id?: string } | null = null;
    try {
      sessionUser = authToken
        ? (AuthService.verifyJWT(authToken) as { id?: string })
        : null;
    } catch {
      sessionUser = null;
    }
    if (!sessionUser?.id) {
      throw new HttpException(
        'You must be signed in to connect a channel',
        401
      );
    }
    const membership = await this._organizationService.getUserOrgMembership(
      sessionUser.id,
      organization
    );
    if (!membership) {
      throw new HttpException(
        'This connection does not belong to your organization',
        403
      );
    }

    const org = await this._organizationService.getOrgById(organization);

    if (!integrationProvider.customFields) {
      await ioRedis.del(`login:${body.state}`);
    }

    const details = integrationProvider.externalUrl
      ? await ioRedis.get(`external:${body.state}`)
      : undefined;

    if (details) {
      await ioRedis.del(`external:${body.state}`);
    }

    const refresh = await ioRedis.get(`refresh:${body.state}`);
    if (refresh) {
      await ioRedis.del(`refresh:${body.state}`);
    }

    const onboarding = await ioRedis.get(`onboarding:${body.state}`);
    if (onboarding) {
      await ioRedis.del(`onboarding:${body.state}`);
    }

    const {
      error,
      accessToken,
      expiresIn,
      refreshToken,
      id,
      name,
      picture,
      username,
      additionalSettings,
      grantedScopes,
      // eslint-disable-next-line no-async-promise-executor
    } = await new Promise<AuthTokenDetails>(async (res) => {
      try {
        const auth = await integrationProvider.authenticate(
          {
            code: body.code,
            codeVerifier: getCodeVerifier,
            refresh: body.refresh,
          },
          details ? JSON.parse(details) : undefined
        );

        if (typeof auth === 'string') {
          return res({
            error: auth,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        if (refresh && integrationProvider.reConnect) {
          Logger.log('Provider reconnect triggered');
          try {
            const newAuth = await integrationProvider.reConnect(
              auth.id,
              refresh,
              auth.accessToken
            );
            return res({ ...newAuth, refreshToken: body.refresh });
          } catch (err: any) {
            return res({
              error: err.message,
              accessToken: '',
              id: '',
              name: '',
              picture: '',
              username: '',
              additionalSettings: [],
            });
          }
        }

        return res(auth);
      } catch (err) {
        if (err instanceof NotEnoughScopes) {
          return res({
            error: err.message,
            accessToken: '',
            id: '',
            name: '',
            picture: '',
            username: '',
            additionalSettings: [],
          });
        }

        return res({
          error: 'Authentication failed',
          accessToken: '',
          id: '',
          name: '',
          picture: '',
          username: '',
          additionalSettings: [],
        });
      }
    });

    if (error) {
      throw new NotEnoughScopes(error);
    }

    if (!id) {
      throw new NotEnoughScopes('Invalid API key');
    }

    if (refresh && String(id) !== String(refresh)) {
      throw new NotEnoughScopes(
        'Please refresh the channel that needs to be refreshed'
      );
    }

    let validName = name;
    if (!validName) {
      if (username) {
        validName = username.split('.')[0] ?? username;
      } else {
        validName = `Channel_${String(id).slice(0, 8)}`;
      }
    }

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      org.isTrailing &&
      (await this._integrationService.checkPreviousConnections(
        org.id,
        String(id)
      ))
    ) {
      throw new HttpException('', 412);
    }

    // AE2: the channel count + platform allowlist are checked when the OAuth
    // URL is generated (integrations.controller.getIntegrationUrl), but that is
    // a separate request. A user could mint several `state`s while under the
    // cap and then complete them all here, overshooting the plan. Re-check at
    // the actual channel creation. Skip on refresh/reconnect and when the
    // channel already exists (an update adds no new channel).
    if (process.env.STRIPE_PUBLISHABLE_KEY && !refresh) {
      const list = await this._integrationService.getIntegrationsList(org.id);
      const alreadyConnected = list.some(
        (i) =>
          i.internalId === String(id) &&
          i.providerIdentifier === integration
      );
      if (!alreadyConnected) {
        const subscription =
          await this._subscriptionService.getSubscriptionByOrganizationId(
            org.id
          );
        const tier = subscription?.subscriptionTier || 'FREE';
        const allowed =
          pricing[tier]?.allowedProviders || pricing.FREE.allowedProviders;
        if (!allowed.includes(integration)) {
          throw new HttpException(
            'This platform is not available on your plan',
            402
          );
        }
        const activeChannels = list.filter(
          (i) => !i.refreshNeeded && !i.disabled
        ).length;
        const limit = channelLimitFor({
          isTrailing: org.isTrailing,
          subscription: subscription
            ? { totalChannels: subscription.totalChannels }
            : null,
        });
        if (limit && activeChannels >= limit) {
          throw new HttpException(
            'You have reached the maximum number of channels for your plan',
            402
          );
        }
      }
    }

    const createUpdate =
      await this._integrationService.createOrUpdateIntegration(
        additionalSettings,
        !!integrationProvider.oneTimeToken,
        org.id,
        validName.trim(),
        picture,
        'social',
        String(id),
        integration,
        accessToken,
        refreshToken,
        expiresIn,
        username,
        refresh ? false : integrationProvider.isBetweenSteps,
        body.refresh,
        +body.timezone,
        details
          ? AuthService.fixedEncryption(details)
          : integrationProvider.customFields
          ? AuthService.fixedEncryption(
              Buffer.from(body.code, 'base64').toString()
            )
          : integrationProvider.isChromeExtension
          ? AuthService.fixedEncryption(
              Buffer.from(body.code, 'base64').toString()
            )
          : undefined,
        grantedScopes
      );

    this._refreshIntegrationService
      .startRefreshWorkflow(org.id, createUpdate.id, integrationProvider)
      .catch((err) => {
        Logger.error('Refresh workflow failed', err);
      });

    // Fetch pages if this is a two-step provider and not a refresh
    let pages: any[] = [];
    if (integrationProvider.isBetweenSteps && !refresh) {
      try {
        // Check which method the provider uses (pages or companies)
        const fetchMethod =
          'pages' in integrationProvider
            ? 'pages'
            : 'companies' in integrationProvider
            ? 'companies'
            : null;

        if (fetchMethod) {
          // @ts-ignore - dynamic method call
          pages = await integrationProvider[fetchMethod](accessToken);
        }
      } catch (err) {
        Logger.warn('Failed to fetch pages', err);
      }
    }

    const webhookUrl = await ioRedis.get(`webhookUrl:${body.state}`);
    if (webhookUrl) {
      try {
        await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            params: AuthService.signJWT({
              apiKey: org.apiKey,
            }),
          }),
        });
      } catch (err) {}

      await ioRedis.del(`webhookUrl:${body.state}`);
    }

    const returnURL = await ioRedis.get(`redirect:${body.state}`);
    if (returnURL) {
      await ioRedis.del(`redirect:${body.state}`);
    }

    const extensionToken = integrationProvider.isChromeExtension
      ? AuthService.signJWT({
          integrationId: createUpdate.id,
          organizationId: org.id,
          internalId: String(id),
          provider: integration,
        })
      : undefined;

    // Never leak stored credentials (signed/encrypted secrets) back to the
    // caller. These columns hold the integration access token, refresh token
    // and encrypted custom instance details and must stay server-side.
    const {
      token: _token,
      refreshToken: _refreshToken,
      customInstanceDetails: _customInstanceDetails,
      ...safeIntegration
    } = createUpdate as any;

    return {
      ...safeIntegration,
      onboarding: onboarding === 'true',
      pages,
      ...(returnURL ? { returnURL } : {}),
      ...(extensionToken ? { extensionToken } : {}),
    };
  }

  @Post('/public/provider/:id/connect')
  async saveProviderPage(@Param('id') id: string, @Body() body: any) {
    if (!body.state) {
      throw new Error('Invalid state');
    }

    const organization = await ioRedis.get(`organization:${body.state}`);
    if (!organization) {
      throw new Error('Organization not found');
    }

    const org = await this._organizationService.getOrgById(organization);

    return this._integrationService.saveProviderPage(org.id, id, body);
  }

  @Post('/extension-refresh')
  async extensionRefreshCookies(
    @Body() body: { jwt: string; cookies: string }
  ) {
    let payload: any;
    try {
      payload = AuthService.verifyJWT(body.jwt);
    } catch {
      throw new HttpException('Invalid token', 401);
    }

    const { integrationId, organizationId, internalId, provider } = payload;
    if (!integrationId || !organizationId || !internalId || !provider) {
      throw new HttpException('Invalid token payload', 400);
    }

    const integration = await this._integrationService.getIntegrationById(
      organizationId,
      integrationId
    );
    if (!integration || integration.internalId !== internalId) {
      throw new HttpException('Integration not found', 404);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(provider);
    if (!integrationProvider?.isChromeExtension) {
      throw new HttpException('Not a Chrome extension integration', 400);
    }

    let cookiesPayload: any;
    try {
      cookiesPayload = JSON.parse(Buffer.from(body.cookies, 'base64').toString());
    } catch {
      throw new HttpException('Invalid cookies payload', 400);
    }

    const authResult = await integrationProvider.authenticate({
      code: body.cookies,
      codeVerifier: '',
    });

    if (typeof authResult === 'string') {
      throw new HttpException(authResult, 400);
    }

    if (String(authResult.id) !== String(integration.internalId)) {
      await this._integrationService.refreshNeeded(
        organizationId,
        integrationId
      );
      return { success: false, reason: 'account_mismatch' };
    }

    await this._integrationService.createOrUpdateIntegration(
      undefined,
      false,
      organizationId,
      integration.name,
      undefined,
      'social',
      integration.internalId,
      integration.providerIdentifier,
      authResult.accessToken,
      '',
      authResult.expiresIn,
      undefined,
      false,
      undefined,
      undefined,
      AuthService.signJWT(cookiesPayload)
    );

    return { success: true };
  }
}
