import { Throttle } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Query,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { IntegrationFunctionDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.function.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { channelLimitFor, pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { ApiTags } from '@nestjs/swagger';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { IntegrationNameDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.name.dto';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';

import { timer } from '@gitroom/helpers/utils/timer';
import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { MoltbookProvider } from '@gitroom/nestjs-libraries/integrations/social/moltbook.provider';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { uniqBy } from 'lodash';
import { canPostComments } from '@gitroom/nestjs-libraries/integrations/social/comment.capability';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';

// Composer pickers that read from the platform but are not @Tool methods.
const PICKER_FUNCTIONS = new Set([
  // The editor's @-mention search (POST /integrations/mentions); refused, it
  // fell back to the cache and looked like "no results" (INT-15).
  'mention',
  'pages',
  'companies',
  'company',
  'tags',
  'creatorInfo',
  'postTypes',
  'restrictions',
  'subreddits',
]);

// What a picker returns goes to the browser of whoever opened it, a plain
// member included. Facebook's page list carried every page's access token
// (E2E-08-28); the server fetches the page token itself once a page is chosen.
const TOKEN_KEYS = new Set([
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
]);
export const withoutProviderTokens = (value: unknown): any => {
  if (Array.isArray(value)) {
    return value.map(withoutProviderTokens);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !TOKEN_KEYS.has(key))
        .map(([key, item]) => [key, withoutProviderTokens(item)])
    );
  }
  return value;
};

export const isCallableProviderFunction = (provider: object, name: unknown) => {
  if (typeof name !== 'string') return false;
  const tools: { methodName: string }[] =
    Reflect.getMetadata('custom:tool', Object.getPrototypeOf(provider)) || [];
  const allowed = PICKER_FUNCTIONS.has(name) || tools.some((t) => t.methodName === name);
  return allowed && typeof (provider as Record<string, unknown>)[name] === 'function';
};

@ApiTags('Integrations')
@Controller('/integrations')
export class IntegrationsController {
  constructor(
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _postService: PostsService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  @Post('/provider/:id/connect')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @Throttle({ default: { ttl: 300_000, limit: 20 } })
  async saveProviderPage(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: any
  ) {
    return this._integrationService.saveProviderPage(org.id, id, body);
  }

  @Get('/:identifier/internal-plugs')
  getInternalPlugs(@Param('identifier') identifier: string) {
    return this._integrationManager.getInternalPlugs(identifier);
  }

  @Get('/customers')
  getCustomers(@GetOrgFromRequest() org: Organization) {
    return this._integrationService.customers(org.id);
  }

  // Agency clients, disabling and deleting channels: organisation admins only.
  @Put('/:id/group')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateIntegrationGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { group: string }
  ) {
    return this._integrationService.updateIntegrationGroup(
      org.id,
      id,
      body.group
    );
  }

  @Put('/:id/customer-name')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateOnCustomerName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string }
  ) {
    return this._integrationService.updateOnCustomerName(org.id, id, body.name);
  }

  // A name for the channel inside Postra; the platform's name stays as it is.
  @Put('/:id/custom-name')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateCustomName(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationNameDto
  ) {
    return this._integrationService.updateCustomName(org.id, id, body.name);
  }

  @Get('/list')
  async getIntegrationList(@GetOrgFromRequest() org: Organization) {
    // Fire-and-forget: lazily verify tokens are still valid so a channel the
    // user revoked on the platform gets the "needs reconnect" flag on the next
    // load. Never blocks the response.
    this._integrationService.checkIntegrationsHealth(org.id).catch(() => {});
    return {
      integrations: await Promise.all(
        (
          await this._integrationService.getIntegrationsList(org.id)
        ).map(async (p) => {
          const findIntegration = this._integrationManager.getSocialIntegration(
            p.providerIdentifier
          );
          return {
            name: p.customName || p.name,
            originalName: p.name,
            id: p.id,
            internalId: p.internalId,
            disabled: p.disabled,
            editor: findIntegration.editor,
            stripLinks: !!findIntegration?.stripLinks?.(),
            picture: p.picture || '/no-picture.jpg',
            identifier: p.providerIdentifier,
            inBetweenSteps: p.inBetweenSteps,
            refreshNeeded: p.refreshNeeded,
            // Per channel, not per provider: Meta grants the first-comment
            // scope only to accounts holding a role in the app, so one Page
            // can take comments while the next one can't. The composer hides
            // the option where the comment would be dropped at publish.
            canComment: canPostComments(findIntegration, p),
            isCustomFields: !!findIntegration.customFields,
            ...(findIntegration.customFields
              ? { customFields: await findIntegration.customFields() }
              : {}),
            display: p.profile,
            type: p.type,
            time: JSON.parse(p.postingTimes),
            changeProfilePicture: !!findIntegration?.changeProfilePicture,
            changeNickName: !!findIntegration?.changeNickname,
            customer: p.customer,
            additionalSettings: p.additionalSettings || '[]',
          };
        })
      ),
    };
  }

  @Post('/:id/settings')
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('additionalSettings') body: string
  ) {
    if (typeof body !== 'string') {
      throw new BadRequestException('Invalid body');
    }

    await this._integrationService.updateProviderSettings(org.id, id, body);
  }
  @Post('/:id/nickname')
  async setNickname(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { name: string; picture: string }
  ) {
    const integration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );
    if (!integration) {
      throw new NotFoundException('Channel not found');
    }

    const manager = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );
    if (!manager.changeProfilePicture && !manager.changeNickname) {
      throw new NotFoundException('Channel not found');
    }

    const { url } = manager.changeProfilePicture
      ? await manager.changeProfilePicture(
          integration.internalId,
          integration.token,
          body.picture
        )
      : { url: '' };

    const { name } = manager.changeNickname
      ? await manager.changeNickname(
          integration.internalId,
          integration.token,
          body.name
        )
      : { name: '' };

    return this._integrationService.updateNameAndUrl(id, name, url);
  }

  @Get('/:id')
  getSingleIntegration(
    @Param('id') id: string,
    @Query('order') order: string,
    @GetUserFromRequest() user: User,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getIntegrationForOrder(
      id,
      order,
      user.id,
      org.id
    );
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @Query('externalUrl') externalUrl: string,
    @Query('redirectUrl') redirectUrl: string,
    @Query('onboarding') onboarding: string,
    @Query('invite') invite: string,
    @GetOrgFromRequest() org: Organization
  ) {
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      // A bare `Error` here reached the global filter as an unhandled
      // exception: the client got a 500 and Sentry got an event, for what is
      // only an unknown platform name in the URL. Measured on production
      // 2026-09-19: `GET /integrations/social/nieistniejacy` answered
      // `{"statusCode":500,"message":"Internal server error"}`.
      // The tier check a few lines below already does this properly.
      throw new HttpException(`Unknown platform: ${integration}`, 400);
    }

    // `refresh` skips the plan gates below, so it has to name a channel this
    // org already has on this platform. It used to be any string: the callback
    // only compares it with the provider account id, so a FREE org could pass
    // its own X or Discord id and connect a platform outside its plan, past
    // the channel limit too. The callback checks this again.
    if (
      refresh &&
      !(await this._integrationService.hasChannel(org.id, integration, refresh))
    ) {
      throw new HttpException('The channel to reconnect was not found', 404);
    }

    // Per-tier platform gating. Only when billing is on (billing off ⇒ every
    // platform); skipped on reconnect (`refresh`) so an existing channel can
    // always be re-authenticated even if it now sits above the org's tier.
    // The tier's allowedProviders list is the single source of truth
    // (edit it in pricing.ts to move a platform between plans).
    if (process.env.STRIPE_PUBLISHABLE_KEY && !refresh) {
      // @ts-ignore subscription is attached to the org by the auth middleware
      const tier = org?.subscription?.subscriptionTier || 'FREE';
      const allowed =
        pricing[tier]?.allowedProviders || pricing.FREE.allowedProviders;
      if (!allowed.includes(integration)) {
        throw new HttpException(
          `The ${integration} channel isn't included in your plan - upgrade to connect it.`,
          402
        );
      }
    }

    // A platform still "Coming soon" takes no new channels (E2E-08-50);
    // after the plan gate, so a plan without it still answers 402.
    if (!refresh && !this._integrationManager.isOffered(integration)) {
      throw new HttpException(
        `The ${integration} channel isn't available yet.`,
        403
      );
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    // Handed back to whoever finishes the connection and navigated to: a web
    // address, a path or the app — never `javascript:` (E2E-08-31). Checked
    // before the try below, which turns errors into a 200.
    if (
      redirectUrl &&
      !/^(https?:\/\/|postra:\/\/|\/(?!\/))/i.test(redirectUrl)
    ) {
      throw new BadRequestException('redirectUrl must be a web address');
    }

    if (integrationProvider.externalUrl && !externalUrl) {
      throw new BadRequestException('Missing external url');
    }

    try {
      const getExternalUrl = integrationProvider.externalUrl
        ? {
            ...(await integrationProvider.externalUrl(externalUrl)),
            instanceUrl: externalUrl,
          }
        : undefined;

      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl(getExternalUrl);

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      if (onboarding === 'true') {
        await ioRedis.set(`onboarding:${state}`, 'true', 'EX', 3600);
      }

      if (redirectUrl) {
        await ioRedis.set(`redirect:${state}`, redirectUrl, 'EX', 3600);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
      await ioRedis.set(
        `external:${state}`,
        JSON.stringify(getExternalUrl),
        'EX',
        3600
      );

      // An invite link is opened by someone who has never seen Postra — an
      // agency's client. Handing them the provider's OAuth URL drops them
      // straight onto Meta's consent screen, where nothing tells them Instagram
      // has to be a professional account linked to a Page: they reach the same
      // empty picker as everyone else, minus every screen we use to explain it.
      // Point the link at a page of ours and keep the provider URL server-side,
      // behind a token of its own rather than the 6-character OAuth state.
      // `state` rides along so the browser that follows the link can be bound
      // to it (see NoAuthIntegrationsController.followInvite).
      if (invite === 'true') {
        // Unguessable: whoever holds it can connect a channel into this org.
        const inviteToken = randomBytes(32).toString('hex');
        await ioRedis.set(
          `invite:${inviteToken}`,
          JSON.stringify({ url, state, provider: integration }),
          'EX',
          3600
        );
        return {
          url: `${process.env.FRONTEND_URL}/connect/${integration}/${inviteToken}`,
        };
      }

      return { url };
    } catch (err) {
      return { err: true };
    }
  }

  @Post('/:id/time')
  async setTime(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: IntegrationTimeDto
  ) {
    return this._integrationService.setTimes(org.id, id, body);
  }

  @Post('/mentions')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  async mentions(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ) {
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new NotFoundException('Channel not found');
    }

    let newList: any[] | { none: true } = [];
    try {
      newList = (await this.functionIntegration(org, body)) || [];
    } catch (err) {
      Logger.error('Integration function failed', err);
    }

    if (!Array.isArray(newList) && newList?.none) {
      return newList;
    }

    const list = await this._integrationService.getMentions(
      getIntegration.providerIdentifier,
      body?.data?.query
    );

    if (Array.isArray(newList) && newList.length) {
      await this._integrationService.insertMentions(
        getIntegration.providerIdentifier,
        newList
          .map((p: any) => ({
            name: p.label || '',
            username: p.id || '',
            image: p.image || '',
            doNotCache: p.doNotCache || false,
          }))
          .filter((f: any) => f.name && !f.doNotCache)
      );
    }

    return uniqBy(
      [
        ...list.map((p) => ({
          id: p.username,
          image: p.image,
          label: p.name,
        })),
        ...(newList as any[]),
      ],
      (p) => p.id
    ).filter((f) => f.label && f.id);
  }

  @Post('/function')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  functionIntegration(
    @GetOrgFromRequest() org: Organization,
    @Body() body: IntegrationFunctionDto
  ): Promise<any> {
    return this.runProviderFunction(org, body, false);
  }

  // One refresh per request: a platform refusing the refreshed token too made
  // the route refresh and call itself with no end (Codex review, E2E-08-63).
  private async runProviderFunction(
    org: Organization,
    body: IntegrationFunctionDto,
    refreshed: boolean
  ): Promise<any> {
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      body.id
    );
    if (!getIntegration) {
      throw new NotFoundException('Channel not found');
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );
    if (!integrationProvider) {
      throw new BadRequestException('Invalid provider');
    }

    // The method name comes from the client. Only what the composer calls
    // may run: methods marked @Tool plus the pickers that are not tools. Any
    // truthy property used to pass, including `constructor`, `toString` and
    // the provider's own `post` and `refreshToken` (E2E-02-08).
    if (!isCallableProviderFunction(integrationProvider, body.name)) {
      throw new NotFoundException('Function not found');
    }

    // @ts-ignore
    if (integrationProvider[body.name]) {
      try {
        // @ts-ignore
        const load = await integrationProvider[body.name](
          getIntegration.token,
          body.data,
          getIntegration.internalId,
          getIntegration
        );

        return withoutProviderTokens(load);
      } catch (err) {
        if (err instanceof RefreshToken) {
          if (refreshed) {
            return false;
          }
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            return;
          }

          const { accessToken } = data;

          if (accessToken) {
            if (integrationProvider.refreshWait) {
              await timer(10000);
            }
            return this.runProviderFunction(org, body, true);
          }

          return false;
        }

        return false;
      }
    }
    throw new NotFoundException('Function not found');
  }

  @Post('/disable')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  disableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/enable')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async enableChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    // Re-enabling is a second entry point for a channel, so it must honour the
    // same per-tier platform allowlist the connect path enforces — otherwise a
    // downgraded org (e.g. Business→Starter) could disable an allowed channel
    // and re-enable a now-forbidden one, keeping a higher-tier platform under
    // the seat count. Skipped when billing is off (every platform allowed).
    if (process.env.STRIPE_PUBLISHABLE_KEY) {
      const integration = await this._integrationService.getIntegrationById(
        org.id,
        id
      );
      // @ts-ignore subscription is attached to the org by the auth middleware
      const tier = org?.subscription?.subscriptionTier || 'FREE';
      const allowed =
        pricing[tier]?.allowedProviders || pricing.FREE.allowedProviders;
      if (
        integration &&
        !allowed.includes(integration.providerIdentifier)
      ) {
        throw new HttpException(
          `The ${integration.providerIdentifier} channel isn't included in your plan - upgrade to enable it.`,
          402
        );
      }
    }

    return this._integrationService.enableChannel(
      org.id,
      // @ts-ignore
      channelLimitFor(org),
      id
    );
  }

  @Delete('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Body('id') id: string
  ) {
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postService.deletePost(org.id, post.group).catch((err) => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Get('/plug/list')
  async getPlugList() {
    return { plugs: this._integrationManager.getAllPlugs() };
  }

  @Get('/:id/plugs')
  async getPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization
  ) {
    return this._integrationService.getPlugsByIntegrationId(org.id, id);
  }

  @Post('/:id/plugs')
  async postPlugsByIntegrationId(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body() body: PlugDto
  ) {
    return this._integrationService.createOrUpdatePlug(org.id, id, body);
  }

  @Put('/plugs/:id/activate')
  async changePlugActivation(
    @Param('id') id: string,
    @GetOrgFromRequest() org: Organization,
    @Body('status') status: boolean
  ) {
    return this._integrationService.changePlugActivation(org.id, id, status);
  }

  @Get('/telegram/updates')
  @Throttle({ default: { ttl: 300_000, limit: 300 } })
  async getUpdates(@Query() query: { word: string; id?: number }) {
    return new TelegramProvider().getBotId(query);
  }

  @Post('/moltbook/register')
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async moltbookRegister(@Body() body: { name: string; description: string }) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.registerAgent(body.name, body.description);
      return {
        apiKey: result.api_key,
        claimUrl: result.claim_url,
        verificationCode: result.verification_code,
      };
    } catch (err: any) {
      return { error: err.message || 'Registration failed' };
    }
  }

  @Get('/moltbook/status')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async moltbookStatus(@Query('apiKey') apiKey: string) {
    try {
      const provider = new MoltbookProvider();
      const result = await provider.checkAgentStatus(apiKey);
      return { claimed: result?.status === 'claimed' };
    } catch (err) {
      return { claimed: false };
    }
  }
}
