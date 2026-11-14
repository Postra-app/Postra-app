import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  AuthTokenDetails,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { TemporalService } from 'nestjs-temporal-core';
import { timer } from '@gitroom/helpers/utils/timer';

const TRANSIENT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/**
 * A refresh that failed because the provider or the network was briefly down,
 * not because the grant is gone. Everything else still counts as "reconnect
 * needed" — only the unmistakable outages are let through.
 */
export const isTransientRefreshError = (err: any): boolean => {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  const status = Number(
    err.status ?? err.statusCode ?? err.response?.status ?? NaN
  );
  if (status === 429 || (status >= 500 && status < 600)) return true;
  const code = err.code ?? err.cause?.code;
  if (code && TRANSIENT_CODES.has(code)) return true;
  // undici: `TypeError: fetch failed` with the socket error as the cause.
  return err instanceof TypeError && err.message === 'fetch failed';
};

@Injectable()
export class RefreshIntegrationService {
  constructor(
    private _integrationManager: IntegrationManager,
    @Inject(forwardRef(() => IntegrationService))
    private _integrationService: IntegrationService,
    private _temporalService: TemporalService
  ) {}
  async refresh(integration: Integration, cause = ''): Promise<false | AuthTokenDetails> {
    const socialProvider = this._integrationManager.getSocialIntegration(
      integration.providerIdentifier
    );

    const refresh = await this.refreshProcess(integration, socialProvider, cause);

    if (!refresh) {
      return false as const;
    }

    // Removed while the provider was answering: writing the new tokens back
    // went through an upsert that brought the channel back to life, tokens
    // and all.
    if (
      !(await this._integrationService.getIntegrationById(
        integration.organizationId,
        integration.id
      ))
    ) {
      return false as const;
    }

    await this._integrationService.saveRefreshedTokens(
      integration,
      !!socialProvider.oneTimeToken,
      refresh
    );

    return refresh;
  }

  public async setBetweenSteps(integration: Integration, cause = '') {
    await this._integrationService.setBetweenRefreshSteps(integration.id);
    await this._integrationService.informAboutRefreshError(
      integration.organizationId,
      integration,
      cause
    );
  }

  public async startRefreshWorkflow(orgId: string, id: string, integration: SocialProvider) {
    if (!integration.refreshCron) {
      return false;
    }

    return this._temporalService.client
      .getRawClient()
      ?.workflow.start(`refreshTokenWorkflow`, {
        workflowId: `refresh_${id}`,
        args: [{integrationId: id, organizationId: orgId}],
        taskQueue: 'main',
        workflowIdConflictPolicy: 'TERMINATE_EXISTING',
      });
  }

  // Waits for a refresh running in another flow to store its tokens (it does
  // so only after the provider answered), then hands them out instead of
  // flagging the channel. Only a renewal of the same account counts: a
  // different refresh token and access token than this flow started with,
  // not yet expired, on a channel that is not flagged, deleted or between
  // steps. Tokens are stored encrypted with a random IV, so they are compared
  // decrypted. Anything else takes the failure path, a few seconds later.
  private async renewedByAnotherFlow(
    integration: Integration
  ): Promise<AuthTokenDetails | false> {
    const started = {
      token: AuthService.decryptIntegrationToken(integration.token),
      refreshToken: AuthService.decryptIntegrationToken(integration.refreshToken),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = await this._integrationService.getIntegrationById(
        integration.organizationId,
        integration.id
      );
      if (
        !stored ||
        stored.refreshNeeded ||
        stored.inBetweenSteps ||
        stored.deletedAt
      ) {
        return false;
      }
      const token = AuthService.decryptIntegrationToken(stored.token);
      const refreshToken = AuthService.decryptIntegrationToken(
        stored.refreshToken
      );
      if (
        stored.internalId === integration.internalId &&
        stored.providerIdentifier === integration.providerIdentifier &&
        token &&
        refreshToken &&
        refreshToken !== started.refreshToken &&
        token !== started.token &&
        stored.tokenExpiration &&
        new Date(stored.tokenExpiration).getTime() > Date.now()
      ) {
        return {
          id: stored.internalId,
          name: stored.name,
          username: stored.profile || '',
          picture: stored.picture || '',
          accessToken: token,
          refreshToken,
          expiresIn: Math.floor(
            (new Date(stored.tokenExpiration).getTime() - Date.now()) / 1000
          ),
        };
      }
      if (attempt < 2) {
        await timer(1000 * (attempt + 1));
      }
    }
    return false;
  }

  private async refreshProcess(
    integration: Integration,
    socialProvider: SocialProvider,
    cause = ''
  ): Promise<AuthTokenDetails | false> {
    let transient = false;
    let refreshError: any;
    const refresh: false | AuthTokenDetails = await socialProvider
      .refreshToken(AuthService.decryptIntegrationToken(integration.refreshToken))
      .catch((err) => {
        refreshError = err;
        transient = isTransientRefreshError(err);
        return false;
      });

    // The reason was swallowed, so a dead channel left nothing to go on
    // (upstream 49aa92ac). The message only, never the request.
    if (refreshError) {
      console.error(
        `[refresh] ${integration.providerIdentifier} ${integration.id} failed${
          transient ? ' (transient)' : ''
        }: ${refreshError?.message || refreshError}`
      );
    }

    // A 503, a 429 or a dropped connection used to mark a healthy channel
    // "reconnect needed" and disconnect it. This attempt still
    // fails; the channel stays as it is for the next one.
    if (transient) {
      return false;
    }

    if (!refresh || !refresh.accessToken) {
      // Two flows can refresh one channel at once (two posts at the same
      // minute, a post and analytics). A provider that replaces the refresh
      // token on every refresh (TikTok) accepts the first and rejects the
      // second, which flagged a channel the first flow had just renewed and
      // told the customer to reconnect (upstream 878636e82).
      const renewed = await this.renewedByAnotherFlow(integration);
      if (renewed) {
        return renewed;
      }

      // A provider that returns no token without throwing left no trace.
      if (!refreshError) {
        console.error(
          `[refresh] ${integration.providerIdentifier} ${integration.id} failed: no access token returned`
        );
      }

      const flagged = await this._integrationService.refreshNeeded(
        integration.organizationId,
        integration.id
      );

      // disconnectChannel tells the customer; telling them here as well sent
      // the same notice twice (upstream 49aa92ac). Only the attempt that
      // flagged the channel tells them (upstream 5a5e50f4e).
      if (flagged) {
        await this._integrationService.disconnectChannel(
          integration.organizationId,
          integration,
          socialProvider.refreshErrorMessage?.(refreshError) || cause
        );
      }

      return false;
    }

    if (
      !socialProvider.reConnect ||
      integration.rootInternalId === integration.internalId
    ) {
      return refresh;
    }

    let reConnect;
    try {
      reConnect = await socialProvider.reConnect(
        integration.rootInternalId,
        integration.internalId,
        refresh.accessToken
      );
    } catch (err: any) {
      // The message only, never the request (upstream #1884).
      console.error(
        `[refresh] ${integration.providerIdentifier} ${integration.id} reconnect failed after a successful refresh: ${err?.message || err}`
      );
      throw err;
    }

    return {
      ...refresh,
      ...reConnect,
    };
  }
}
