import {
  forwardRef,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { IntegrationRepository } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.repository';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  AnalyticsData,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { Integration, Organization } from '@prisma/client';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import dayjs from 'dayjs';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';
import { difference, uniq } from 'lodash';
import utc from 'dayjs/plugin/utc';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { TemporalService } from 'nestjs-temporal-core';
import { fetch } from 'undici';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

dayjs.extend(utc);

@Injectable()
export class IntegrationService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integrationRepository: IntegrationRepository,
    private _autopostsRepository: AutopostRepository,
    private _integrationManager: IntegrationManager,
    private _notificationService: NotificationService,
    @Inject(forwardRef(() => RefreshIntegrationService))
    private _refreshIntegrationService: RefreshIntegrationService,
    private _temporalService: TemporalService,
    private _auditService: AuditService
  ) {}

  async changeActiveCron(orgId: string) {
    const data = await this._autopostsRepository.getAutoposts(orgId);

    for (const item of data.filter((f) => f.active)) {
      try {
        await this._temporalService.terminateWorkflow(`autopost-${item.id}`);
      } catch (err) {}
    }

    return true;
  }

  getMentions(platform: string, q: string) {
    return this._integrationRepository.getMentions(platform, q);
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    return this._integrationRepository.insertMentions(platform, mentions);
  }

  async setTimes(
    orgId: string,
    integrationId: string,
    times: IntegrationTimeDto
  ) {
    return this._integrationRepository.setTimes(orgId, integrationId, times);
  }

  updateProviderSettings(org: string, id: string, additionalSettings: string) {
    return this._integrationRepository.updateProviderSettings(
      org,
      id,
      additionalSettings
    );
  }

  checkPreviousConnections(org: string, id: string) {
    return this._integrationRepository.checkPreviousConnections(org, id);
  }

  async createOrUpdateIntegration(
    additionalSettings:
      | {
          title: string;
          description: string;
          type: 'checkbox' | 'text' | 'textarea';
          value: any;
          regex?: string;
        }[]
      | undefined,
    oneTimeToken: boolean,
    org: string,
    name: string,
    picture: string | undefined,
    type: 'article' | 'social',
    internalId: string,
    provider: string,
    token: string,
    refreshToken = '',
    expiresIn?: number,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    grantedScopes?: string[]
  ) {
    const existingChannel = await this._integrationRepository.findActiveByProviderIdentifier(
      provider,
      internalId
    );
    if (existingChannel && existingChannel.organizationId !== org) {
      throw new HttpException(
        'This channel is already connected to another Postra account. Disconnect it there first, then try again.',
        HttpStatus.CONFLICT
      );
    }

    // Parse the hostname instead of substring-matching — a URL like
    // https://evil.com/imagedelivery.net would pass indexOf() and get
    // persisted as an external hotlink instead of re-uploaded to our storage.
    const isImageDeliveryHost = (url: string) => {
      try {
        const host = new URL(url).hostname;
        return host === 'imagedelivery.net' || host.endsWith('.imagedelivery.net');
      } catch {
        return false;
      }
    };

    let uploadedPicture: string | undefined;
    if (picture) {
      if (isImageDeliveryHost(picture)) {
        uploadedPicture = picture;
      } else {
        try {
          uploadedPicture = await this.storage.uploadSimple(picture);
        } catch (err) {
          // Download to our storage failed — do NOT persist the external
          // hotlink. Provider CDN URLs (e.g. Facebook scontent) expire/block
          // hotlinking and later 403 in the browser. Leave it undefined so the
          // UI falls back to /no-picture.jpg. The repository upsert sets picture
          // conditionally (`...(picture ? { picture } : {})`), so an existing
          // avatar is preserved on refresh rather than wiped.
          console.warn(
            `[integration] avatar download failed for provider "${provider}" — skipping picture:`,
            (err as Error)?.message
          );
          uploadedPicture = undefined;
        }
      }
    }

    this._auditService.record({
      action: 'integration.connect',
      organizationId: org,
      metadata: { provider, internalId, name },
    });

    return this._integrationRepository.createOrUpdateIntegration(
      additionalSettings,
      oneTimeToken,
      org,
      name,
      uploadedPicture,
      type,
      internalId,
      provider,
      token,
      refreshToken,
      expiresIn,
      username,
      isBetweenSteps,
      refresh,
      timezone,
      customInstanceDetails,
      grantedScopes
    );
  }

  // Meta echoes the offending access token back inside its error messages
  // ("Malformed access token EAA…"), and this report is printed to a console
  // whose output lands in deploy logs and SSM results. Strip anything
  // token-shaped before it gets there.
  private redactMetaToken(message: string) {
    return message.replace(/EAA[A-Za-z0-9_-]+/g, '<redacted token>');
  }

  // One-off after the grantedScopes column lands: ask Meta what each already
  // connected token actually holds. Without it every existing channel reads as
  // "no scopes" and loses first comment until someone reconnects it by hand.
  // Only ever writes grantedScopes — tokens are read, never touched.
  async backfillGrantedScopes(apply: boolean) {
    const appToken = `${process.env.FACEBOOK_APP_ID}|${process.env.FACEBOOK_APP_SECRET}`;

    if (!process.env.FACEBOOK_APP_ID || !process.env.FACEBOOK_APP_SECRET) {
      throw new Error(
        'FACEBOOK_APP_ID / FACEBOOK_APP_SECRET are required to inspect tokens'
      );
    }

    const integrations =
      await this._integrationRepository.integrationsMissingGrantedScopes([
        'facebook',
        'instagram',
      ]);

    const report: {
      id: string;
      name: string;
      provider: string;
      granted?: string[];
      canComment?: boolean;
      error?: string;
    }[] = [];

    for (const integration of integrations) {
      const row = {
        id: integration.id,
        name: integration.name,
        provider: integration.providerIdentifier,
      } as (typeof report)[number];

      try {
        // NOT /me/permissions: what we store is the Page token (Facebook) or a
        // "pageToken___userToken" pair (Instagram), and /me on a Page token
        // resolves to the Page, which has no permissions edge. debug_token
        // reports the scopes of the authorization behind any of them.
        const response = await fetch(
          `https://graph.facebook.com/v20.0/debug_token?input_token=${
            integration.token.split('___')[0]
          }&access_token=${appToken}`
        );
        const body = (await response.json()) as {
          data?: { scopes?: string[] };
          error?: { message?: string };
        };

        const granted = body?.data?.scopes;

        if (!granted) {
          row.error = this.redactMetaToken(
            body?.error?.message || 'no scopes returned'
          );
          report.push(row);
          continue;
        }

        row.granted = granted;
        // Ask the provider which scope carries first comment instead of naming
        // Facebook's: this loop also walks Instagram channels, whose scope is
        // instagram_manage_comments, and hard-coding one of them reported every
        // working Instagram channel as "not granted". The report is what we read
        // to decide which channels need a reconnect, so it has to be per-provider.
        const commentScope = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        )?.commentScope;
        row.canComment = !commentScope || granted.includes(commentScope);

        if (apply) {
          await this._integrationRepository.setGrantedScopes(
            integration.id,
            granted
          );
        }
      } catch (err) {
        row.error = this.redactMetaToken(
          (err as Error)?.message || 'request failed'
        );
      }

      report.push(row);
    }

    return report;
  }

  updateIntegrationGroup(org: string, id: string, group: string) {
    return this._integrationRepository.updateIntegrationGroup(org, id, group);
  }

  updateOnCustomerName(org: string, id: string, name: string) {
    return this._integrationRepository.updateOnCustomerName(org, id, name);
  }

  getIntegrationsList(org: string) {
    return this._integrationRepository.getIntegrationsList(org);
  }

  backfillTokenEncryption(apply = true) {
    return this._integrationRepository.backfillTokenEncryption(apply);
  }

  getIntegrationForOrder(id: string, order: string, user: string, org: string) {
    return this._integrationRepository.getIntegrationForOrder(
      id,
      order,
      user,
      org
    );
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integrationRepository.updateNameAndUrl(id, name, url);
  }

  getIntegrationById(org: string, id: string) {
    return this._integrationRepository.getIntegrationById(org, id);
  }

  getIntegrationsByIds(org: string, ids: string[]) {
    return this._integrationRepository.getIntegrationsByIds(org, ids);
  }

  async refreshToken(provider: SocialProvider, refresh: string) {
    try {
      const { refreshToken, accessToken, expiresIn } =
        await provider.refreshToken(refresh);

      if (!refreshToken || !accessToken || !expiresIn) {
        return false;
      }

      return { refreshToken, accessToken, expiresIn };
    } catch (e) {
      return false;
    }
  }

  async disconnectChannel(orgId: string, integration: Integration) {
    this._auditService.record({
      action: 'integration.disconnect',
      organizationId: orgId,
      metadata: {
        integrationId: integration.id,
        provider: integration.providerIdentifier,
      },
    });
    await this._integrationRepository.disconnectChannel(orgId, integration.id);
    await this.informAboutRefreshError(orgId, integration);
  }

  async informAboutRefreshError(
    orgId: string,
    integration: Integration,
    err = ''
  ) {
    await this._notificationService.inAppNotification(
      orgId,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}`,
      `Could not refresh your ${integration.providerIdentifier} channel ${err}. Please go back to the system and connect it again ${process.env.FRONTEND_URL}/launches`,
      true,
      false,
      'info'
    );
  }

  async refreshNeeded(org: string, id: string) {
    return this._integrationRepository.refreshNeeded(org, id);
  }

  // Lazily verify that connected channels are still authorized. When a user
  // revokes the app on the platform side, the stored token dies but nothing
  // detects it until the next publish — so the channel still looks healthy.
  // This flags such channels (refreshNeeded -> red "!" badge) on the next
  // channel-list load. Runs fire-and-forget, is Redis-cached so it checks each
  // channel at most ~twice/hour, and only touches providers that implement
  // checkToken (others are skipped, never false-flagged).
  async checkIntegrationsHealth(org: string) {
    const list = await this._integrationRepository.getIntegrationsList(org);
    for (const integration of list) {
      if (integration.disabled || integration.refreshNeeded) {
        continue;
      }
      const provider = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
      const checkToken = provider?.checkToken?.bind(provider);
      if (!checkToken) {
        continue;
      }
      const cacheKey = `health-check:${integration.id}`;
      if (await ioRedis.get(cacheKey)) {
        continue;
      }
      await ioRedis.set(cacheKey, '1', 'EX', 1800);
      try {
        const alive = await checkToken(
          AuthService.decryptIntegrationToken(integration.token),
          integration.internalId
        );
        if (!alive) {
          await this._integrationRepository.refreshNeeded(org, integration.id);
        }
      } catch {
        // Never flag a channel on an unexpected error.
      }
    }
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integrationRepository.setBetweenRefreshSteps(id);
  }

  /**
   * Refresh every channel whose token is due.
   *
   * The failure branch used to `return`, not `continue`, so one expired
   * channel anywhere in the list silently skipped the refresh of every channel
   * after it — and printed nothing, so the operator assumed they had all been
   * refreshed. This is the manual rescue path for expired tokens, which means
   * it failed at exactly the moment it was needed (E2E-09-43).
   *
   * Returns a per-channel outcome so a partial run is visible.
   */
  async refreshTokens(apply = true) {
    const integrations = await this._integrationRepository.needsToBeRefreshed();
    const refreshed: Array<{
      id: string;
      name: string;
      provider: string;
      expiredFor?: number;
      scheduled?: boolean;
    }> = [];
    const failed: Array<{ id: string; name: string; provider: string }> = [];

    for (const integration of integrations) {
      const provider0 = this._integrationManager.getSocialIntegration(
        integration.providerIdentifier
      );
      // `needsToBeRefreshed` selects tokenExpiration <= now + 24h, which for a
      // provider whose access token lives an hour (YouTube) or a day (TikTok)
      // is the permanent steady state, not a problem. Reported separately, so
      // "3 channels due" stops reading as an incident: what an operator has to
      // act on is a token that is *already* expired on a channel no scheduled
      // workflow watches.
      const expiration = integration.tokenExpiration
        ? new Date(integration.tokenExpiration).getTime()
        : null;
      const expiredFor = expiration
        ? Math.max(0, Math.round((Date.now() - expiration) / 1000))
        : 0;

      const describe = {
        id: integration.id,
        name: integration.name,
        provider: integration.providerIdentifier,
        expiredFor,
        // refreshCron is what puts a channel under refreshTokenWorkflow, which
        // is started once, at connect time. Without it, the only refresh is the
        // reactive one on a 401 during publishing — by design for short-lived
        // tokens, but it means an idle channel stays stale until someone posts.
        scheduled: !!provider0?.refreshCron,
      };

      const provider = provider0;

      if (!apply) {
        refreshed.push(describe);
        continue;
      }

      const data = await this.refreshToken(provider, integration.refreshToken!);

      if (!data) {
        await this.informAboutRefreshError(
          integration.organizationId,
          integration
        );
        await this._integrationRepository.refreshNeeded(
          integration.organizationId,
          integration.id
        );
        failed.push(describe);
        continue;
      }

      const { refreshToken, accessToken, expiresIn } = data;

      await this.createOrUpdateIntegration(
        undefined,
        !!provider.oneTimeToken,
        integration.organizationId,
        integration.name,
        undefined,
        'social',
        integration.internalId,
        integration.providerIdentifier,
        accessToken,
        refreshToken,
        expiresIn
      );

      refreshed.push(describe);
    }

    return { total: integrations.length, refreshed, failed };
  }

  async disableChannel(org: string, id: string) {
    return this._integrationRepository.disableChannel(org, id);
  }

  async enableChannel(org: string, totalChannels: number, id: string) {
    const integrations = (
      await this._integrationRepository.getIntegrationsList(org)
    ).filter((f) => !f.disabled);
    if (
      !!process.env.STRIPE_PUBLISHABLE_KEY &&
      integrations.length >= totalChannels
    ) {
      throw new Error('You have reached the maximum number of channels');
    }

    return this._integrationRepository.enableChannel(org, id);
  }

  async getPostsForChannel(org: string, id: string) {
    return this._integrationRepository.getPostsForChannel(org, id);
  }

  async deleteChannel(org: string, id: string) {
    this._auditService.record({
      action: 'integration.disconnect',
      organizationId: org,
      metadata: { integrationId: id, deleted: true },
    });
    return this._integrationRepository.deleteChannel(org, id);
  }

  async disableIntegrations(org: string, totalChannels: number) {
    return this._integrationRepository.disableIntegrations(org, totalChannels);
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integrationRepository.checkForDeletedOnceAndUpdate(org, page);
  }

  async saveProviderPage(org: string, id: string, data: any) {
    const getIntegration = await this._integrationRepository.getIntegrationById(
      org,
      id
    );
    if (!getIntegration) {
      throw new HttpException('Integration not found', HttpStatus.NOT_FOUND);
    }
    if (!getIntegration.inBetweenSteps) {
      throw new HttpException('Invalid request', HttpStatus.BAD_REQUEST);
    }

    const provider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (!provider.fetchPageInformation) {
      throw new HttpException(
        'Provider does not support page selection',
        HttpStatus.BAD_REQUEST
      );
    }

    const getIntegrationInformation = await provider.fetchPageInformation(
      getIntegration.token,
      data
    );

    await this.checkForDeletedOnceAndUpdate(
      org,
      String(getIntegrationInformation.id)
    );
    await this._integrationRepository.updateIntegration(id, {
      picture: getIntegrationInformation.picture,
      internalId: String(getIntegrationInformation.id),
      organizationId: org,
      name: getIntegrationInformation.name,
      inBetweenSteps: false,
      token: getIntegrationInformation.access_token,
      profile: getIntegrationInformation.username,
    });

    return { success: true };
  }

  async checkAnalytics(
    org: Organization,
    integration: string,
    date: string,
    forceRefresh = false
  ): Promise<AnalyticsData[]> {
    const getIntegration = await this.getIntegrationById(org.id, integration);

    if (!getIntegration) {
      throw new Error('Invalid integration');
    }

    if (getIntegration.type !== 'social') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this.disconnectChannel(org.id, getIntegration);
        return [];
      }
    }

    const getIntegrationData = await ioRedis.get(
      `integration:${org.id}:${integration}:${date}`
    );
    if (getIntegrationData) {
      return JSON.parse(getIntegrationData);
    }

    if (integrationProvider.analytics) {
      try {
        const loadAnalytics = await integrationProvider.analytics(
          getIntegration.internalId,
          getIntegration.token,
          +date
        );
        await ioRedis.set(
          `integration:${org.id}:${integration}:${date}`,
          JSON.stringify(loadAnalytics),
          'EX',
          !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
            ? 1
            : 3600
        );
        return loadAnalytics;
      } catch (e) {
        // Retry once after a token refresh; a second RefreshToken means the
        // refresh didn't help — recursing again would loop forever.
        if (e instanceof RefreshToken && !forceRefresh) {
          return this.checkAnalytics(org, integration, date, true);
        }
      }
    }

    return [];
  }

  customers(orgId: string) {
    return this._integrationRepository.customers(orgId);
  }

  getPlugsByIntegrationId(org: string, integrationId: string) {
    return this._integrationRepository.getPlugsByIntegrationId(
      org,
      integrationId
    );
  }

  async processInternalPlug(
    data: {
      post: string;
      originalIntegration: string;
      integration: string;
      plugName: string;
      orgId: string;
      delay: number;
      information: any;
    },
    forceRefresh = false
  ): Promise<any> {
    const originalIntegration =
      await this._integrationRepository.getIntegrationById(
        data.orgId,
        data.originalIntegration
      );

    const getIntegration = await this._integrationRepository.getIntegrationById(
      data.orgId,
      data.integration
    );

    if (!getIntegration || !originalIntegration) {
      return;
    }

    const getAllInternalPlugs = this._integrationManager
      .getInternalPlugs(getIntegration.providerIdentifier)
      .internalPlugs.find((p: any) => p.identifier === data.plugName);

    if (!getAllInternalPlugs) {
      return;
    }

    const getSocialIntegration = this._integrationManager.getSocialIntegration(
      getIntegration.providerIdentifier
    );

    // @ts-ignore
    await getSocialIntegration?.[getAllInternalPlugs.methodName]?.(
      getIntegration,
      originalIntegration,
      data.post,
      data.information
    );

    return;
  }

  async processPlugs(data: {
    plugId: string;
    postId: string;
    delay: number;
    totalRuns: number;
    currentRun: number;
  }) {
    const getPlugById = await this._integrationRepository.getPlug(data.plugId);
    if (!getPlugById) {
      return true;
    }

    const integration = this._integrationManager.getSocialIntegration(
      getPlugById.integration.providerIdentifier
    );

    // @ts-ignore
    const process = await integration[getPlugById.plugFunction](
      getPlugById.integration,
      data.postId,
      JSON.parse(getPlugById.data).reduce((all: any, current: any) => {
        all[current.name] = current.value;
        return all;
      }, {})
    );

    if (process) {
      return true;
    }

    if (data.totalRuns === data.currentRun) {
      return true;
    }

    return false;
  }

  async createOrUpdatePlug(
    orgId: string,
    integrationId: string,
    body: PlugDto
  ) {
    const { activated } = await this._integrationRepository.createOrUpdatePlug(
      orgId,
      integrationId,
      body
    );

    return {
      activated,
    };
  }

  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { id, integrationId, plugFunction } =
      await this._integrationRepository.changePlugActivation(
        orgId,
        plugId,
        status
      );

    return { id };
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._integrationRepository.getPlugs(orgId, integrationId);
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    const exisingData = await this._integrationRepository.loadExisingData(
      methodName,
      integrationId,
      id
    );
    const loadOnlyIds = exisingData.map((p) => p.value);
    return difference(id, loadOnlyIds);
  }

  async findFreeDateTime(
    orgId: string,
    integrationsId?: string
  ): Promise<number[]> {
    const findTimes = await this._integrationRepository.getPostingTimes(
      orgId,
      integrationsId
    );
    return uniq(
      findTimes.reduce((all: any, current: any) => {
        return [
          ...all,
          ...JSON.parse(current.postingTimes).map(
            (p: { time: number }) => p.time
          ),
        ];
      }, [] as number[])
    );
  }
}
