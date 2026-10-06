import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { Integration } from '@prisma/client';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { IntegrationTimeDto } from '@gitroom/nestjs-libraries/dtos/integrations/integration.time.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { PlugDto } from '@gitroom/nestjs-libraries/dtos/plugs/plug.dto';

// What the channel-editing endpoints answer with. A bare update() returns the
// whole row, encrypted access and refresh tokens included (U9, upstream rule
// 2407718e); the frontend reads none of it.
const SAFE_INTEGRATION_FIELDS = {
  id: true,
  name: true,
  picture: true,
  providerIdentifier: true,
  customerId: true,
} as const;

@Injectable()
export class IntegrationRepository {
  private storage = UploadFactory.createStorage();
  constructor(
    private _integration: PrismaRepository<'integration'>,
    private _posts: PrismaRepository<'post'>,
    private _plugs: PrismaRepository<'plugs'>,
    private _exisingPlugData: PrismaRepository<'exisingPlugData'>,
    private _customers: PrismaRepository<'customer'>,
    private _mentions: PrismaRepository<'mentions'>
  ) {}

  // Decrypt the token/refreshToken of an integration (or nested integration)
  // in place. Safe on already-plaintext values (idempotent marker scheme).
  private decryptIntegrationTokens<
    T extends
      | { token?: string | null; refreshToken?: string | null }
      | null
      | undefined
  >(integration: T): T {
    if (integration) {
      if (typeof integration.token === 'string') {
        integration.token = AuthService.decryptIntegrationToken(
          integration.token
        );
      }
      if (typeof integration.refreshToken === 'string') {
        integration.refreshToken = AuthService.decryptIntegrationToken(
          integration.refreshToken
        );
      }
    }
    return integration;
  }

  findActiveByProviderIdentifier(provider: string, internalId: string) {
    return this._integration.model.integration.findFirst({
      where: {
        providerIdentifier: provider,
        internalId,
        deletedAt: null,
      },
      select: {
        id: true,
        organizationId: true,
      },
    });
  }

  getMentions(platform: string, q: string) {
    return this._mentions.model.mentions.findMany({
      where: {
        platform,
        OR: [
          {
            name: {
              contains: q,
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: q,
              mode: 'insensitive',
            },
          },
        ],
      },
      orderBy: {
        name: 'asc',
      },
      take: 100,
      select: {
        name: true,
        username: true,
        image: true,
      },
    });
  }

  insertMentions(
    platform: string,
    mentions: { name: string; username: string; image: string }[]
  ) {
    if (mentions.length === 0) {
      return [] as any[];
    }
    return this._mentions.model.mentions.createMany({
      data: mentions.map((mention) => ({
        platform,
        name: mention.name,
        username: mention.username,
        image: mention.image,
      })),
      skipDuplicates: true,
    });
  }

  async checkPreviousConnections(org: string, id: string) {
    const findIt = await this._integration.model.integration.findMany({
      where: {
        rootInternalId: id,
      },
      select: {
        organizationId: true,
        id: true,
      },
    });

    if (findIt.some((f) => f.organizationId === org)) {
      return false;
    }

    return findIt.length > 0;
  }

  updateProviderSettings(org: string, id: string, settings: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        additionalSettings: settings,
      },
    });
  }

  // Minutes after midnight UTC, kept within one day: the composer stores
  // local-time slots minus the UTC offset, so 00:30 in London in summer
  // arrived as -30. updateMany: update threw on an unknown or foreign id (500).
  // Null when nothing of this org matched.
  async setTimes(org: string, id: string, times: IntegrationTimeDto) {
    const DAY = 24 * 60;
    const postingTimes = times.time.map(({ time }) => ({
      time: ((Math.round(time) % DAY) + DAY) % DAY,
    }));
    const { count } = await this._integration.model.integration.updateMany({
      where: { id, organizationId: org, deletedAt: null },
      data: { postingTimes: JSON.stringify(postingTimes) },
    });
    return count ? { id } : null;
  }

  async getPlug(plugId: string) {
    const plug = await this._plugs.model.plugs.findFirst({
      where: {
        id: plugId,
      },
      include: {
        integration: true,
      },
    });

    if (plug?.integration) {
      this.decryptIntegrationTokens(plug.integration);
    }

    return plug;
  }

  async getPlugs(orgId: string, integrationId: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        integrationId,
        organizationId: orgId,
        activated: true,
      },
      include: {
        integration: {
          select: {
            id: true,
            providerIdentifier: true,
          },
        },
      },
    });
  }

  async updateIntegration(id: string, params: Partial<Integration>) {
    if (params.token) {
      params.token = AuthService.encryptIntegrationToken(params.token);
    }
    if (params.refreshToken) {
      params.refreshToken = AuthService.encryptIntegrationToken(
        params.refreshToken
      );
    }

    if (
      params.picture &&
      (params.picture.indexOf(process.env.CLOUDFLARE_BUCKET_URL!) === -1 ||
        params.picture.indexOf(process.env.FRONTEND_URL!) === -1)
    ) {
      try {
        params.picture = await this.storage.uploadSimple(params.picture);
      } catch {
        // keep original URL if upload fails
      }
    }

    const current = await this._integration.model.integration.findUnique({
      where: { id },
      select: { providerIdentifier: true },
    });
    const existing =
      current &&
      (await this._integration.model.integration.findUnique({
        where: {
          organizationId_providerIdentifier_internalId: {
            organizationId: params.organizationId!,
            providerIdentifier: current.providerIdentifier,
            internalId: params.internalId!,
          },
        },
      }));

    if (existing) {
      await this._posts.model.post.updateMany({
        where: {
          integrationId: id,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      await this._integration.model.integration.update({
        where: {
          id,
        },
        data: {
          internalId: `deleted_${params.internalId}_${makeId(10)}`,
          deletedAt: new Date(),
        },
      });
    }

    return this._integration.model.integration.update({
      where: {
        ...(existing ? { id: existing.id } : { id }),
      },
      data: {
        ...params,
        disabled: false,
        deletedAt: null,
      },
    });
  }

  disconnectChannel(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        refreshNeeded: true,
      },
    });
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
    expiresIn = 999999999,
    username?: string,
    isBetweenSteps = false,
    refresh?: string,
    timezone?: number,
    customInstanceDetails?: string,
    grantedScopes?: string[]
  ) {
    token = AuthService.encryptIntegrationToken(token);
    refreshToken = AuthService.encryptIntegrationToken(refreshToken);

    const postTimes = timezone
      ? {
          postingTimes: JSON.stringify([
            { time: 560 - timezone },
            { time: 850 - timezone },
            { time: 1140 - timezone },
          ]),
        }
      : {};
    const upsert = await this._integration.model.integration.upsert({
      where: {
        organizationId_providerIdentifier_internalId: {
          internalId,
          providerIdentifier: provider,
          organizationId: org,
        },
      },
      create: {
        type: type as any,
        name,
        providerIdentifier: provider,
        token,
        profile: username,
        ...(picture ? { picture } : {}),
        inBetweenSteps: isBetweenSteps,
        refreshToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        ...postTimes,
        organizationId: org,
        refreshNeeded: false,
        rootInternalId: internalId,
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        ...(grantedScopes
          ? { grantedScopes: JSON.stringify(grantedScopes) }
          : {}),
        additionalSettings: additionalSettings
          ? JSON.stringify(additionalSettings)
          : '[]',
      },
      update: {
        ...(additionalSettings
          ? { additionalSettings: JSON.stringify(additionalSettings) }
          : {}),
        ...(customInstanceDetails ? { customInstanceDetails } : {}),
        // Only overwrite when this connect actually reported them — a refresh
        // that can't tell must not wipe what a real authorization recorded.
        ...(grantedScopes
          ? { grantedScopes: JSON.stringify(grantedScopes) }
          : {}),
        type: type as any,
        ...(!refresh
          ? {
              inBetweenSteps: isBetweenSteps,
            }
          : {}),
        ...(picture ? { picture } : {}),
        profile: username,
        providerIdentifier: provider,
        token,
        refreshToken,
        ...(expiresIn
          ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
          : {}),
        internalId,
        organizationId: org,
        deletedAt: null,
        refreshNeeded: false,
      },
    });

    if (oneTimeToken) {
      const rootId =
        (
          await this._integration.model.integration.findFirst({
            where: {
              organizationId: org,
              providerIdentifier: provider,
              internalId: internalId,
            },
          })
        )?.rootInternalId || internalId;

      // This organisation only: the same account connected in another org
      // had its tokens and state overwritten too (INT-9).
      await this._integration.model.integration.updateMany({
        where: {
          id: {
            not: upsert.id,
          },
          rootInternalId: rootId,
          organizationId: org,
          deletedAt: null,
        },
        data: {
          token,
          refreshToken,
          refreshNeeded: false,
          ...(expiresIn
            ? { tokenExpiration: new Date(Date.now() + expiresIn * 1000) }
            : {}),
        },
      });
    }

    return upsert;
  }

  // Channels connected before grantedScopes existed have it null, and null
  // fails closed — so every already-connected Meta channel would lose first
  // comment until it was reconnected by hand. The backfill command asks the
  // platform what each token really holds and fills them in.
  async integrationsMissingGrantedScopes(providers: string[]) {
    const list = await this._integration.model.integration.findMany({
      where: {
        providerIdentifier: { in: providers },
        deletedAt: null,
        disabled: false,
        inBetweenSteps: false,
      },
    });

    return list.map((integration) =>
      this.decryptIntegrationTokens(integration)
    );
  }

  setGrantedScopes(id: string, grantedScopes: string[]) {
    return this._integration.model.integration.update({
      where: { id },
      data: { grantedScopes: JSON.stringify(grantedScopes) },
    });
  }

  async needsToBeRefreshed() {
    const list = await this._integration.model.integration.findMany({
      where: {
        tokenExpiration: {
          lte: dayjs().add(1, 'day').toDate(),
        },
        inBetweenSteps: false,
        deletedAt: null,
        refreshNeeded: false,
      },
      // Bounded batch, soonest-expiring first — the cron used to hydrate and
      // decrypt every expiring integration in one pass.
      orderBy: {
        tokenExpiration: 'asc',
      },
      take: 100,
    });

    return list.map((integration) =>
      this.decryptIntegrationTokens(integration)
    );
  }

  async setBetweenRefreshSteps(id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
      },
      data: {
        inBetweenSteps: true,
      },
    });
  }
  refreshNeeded(org: string, id: string) {
    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        refreshNeeded: true,
      },
    });
  }

  updateNameAndUrl(id: string, name: string, url: string) {
    return this._integration.model.integration.update({
      where: {
        id,
      },
      data: {
        ...(name ? { name } : {}),
        ...(url ? { picture: url } : {}),
      },
      select: SAFE_INTEGRATION_FIELDS,
    });
  }

  // Batched, token-free lookup for post validation paths (avoids one
  // decrypting getIntegrationById per post per request).
  getIntegrationsByIds(org: string, ids: string[]) {
    return this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        id: { in: ids },
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        providerIdentifier: true,
        additionalSettings: true,
      },
    });
  }

  async getIntegrationById(org: string, id: string) {
    return this.decryptIntegrationTokens(
      await this._integration.model.integration.findFirst({
        where: {
          organizationId: org,
          id,
          deletedAt: null,
        },
      })
    );
  }

  async getIntegrationForOrder(
    id: string,
    order: string,
    user: string,
    org: string
  ) {
    const integration = await this._posts.model.post.findFirst({
      where: {
        integrationId: id,
        submittedForOrder: {
          id: order,
          messageGroup: {
            OR: [
              { sellerId: user },
              { buyerId: user },
              { buyerOrganizationId: org },
            ],
          },
        },
      },
      select: {
        integration: {
          select: {
            id: true,
            name: true,
            picture: true,
            inBetweenSteps: true,
            providerIdentifier: true,
          },
        },
      },
    });

    return integration?.integration;
  }

  // Both return null when the channel is not one of this org's live channels
  // (update on a missing row answered 500), and updateIntegrationGroup also
  // when the customer is not this org's: it connected any customer id, so
  // another organisation could hang its channel on your customer and read the
  // customer's name back from its own channel list.
  private ownChannel(org: string, id: string) {
    return this._integration.model.integration.findFirst({
      where: { id, organizationId: org, deletedAt: null },
      select: { id: true },
    });
  }

  async updateOnCustomerName(org: string, id: string, name: string) {
    if (!(await this.ownChannel(org, id))) {
      return null;
    }

    const customer = !name
      ? undefined
      : (await this._customers.model.customer.findFirst({
          where: {
            orgId: org,
            name,
            deletedAt: null,
          },
        })) ||
        (await this._customers.model.customer.create({
          data: {
            name,
            orgId: org,
          },
        }));

    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        customer: !customer
          ? { disconnect: true }
          : {
              connect: {
                id: customer.id,
              },
            },
      },
      select: SAFE_INTEGRATION_FIELDS,
    });
  }

  async updateCustomName(org: string, id: string, name: string) {
    if (!(await this.ownChannel(org, id))) {
      return null;
    }
    // Only the id back: the full row carries the channel's tokens (upstream
    // bb2e0176).
    return this._integration.model.integration.update({
      where: { id },
      data: { customName: name.trim() || null },
      select: { id: true },
    });
  }

  async updateIntegrationGroup(org: string, id: string, group: string) {
    if (!(await this.ownChannel(org, id))) {
      return null;
    }
    if (
      group &&
      !(await this._customers.model.customer.findFirst({
        where: { id: group, orgId: org, deletedAt: null },
        select: { id: true },
      }))
    ) {
      return null;
    }

    return this._integration.model.integration.update({
      where: {
        id,
        organizationId: org,
      },
      data: !group
        ? {
            customer: {
              disconnect: true,
            },
          }
        : {
            customer: {
              connect: {
                id: group,
              },
            },
          },
      select: SAFE_INTEGRATION_FIELDS,
    });
  }

  // Only customers that still have a channel: a customer emptied by moving
  // its last channel away has no other way out of the suggestions.
  customers(orgId: string) {
    return this._customers.model.customer.findMany({
      where: {
        orgId,
        deletedAt: null,
        integrations: { some: { deletedAt: null } },
      },
    });
  }

  async getIntegrationsList(org: string) {
    const list = await this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        deletedAt: null,
      },
      include: {
        customer: true,
      },
    });

    return list.map((integration) =>
      this.decryptIntegrationTokens(integration)
    );
  }

  disableChannel(org: string, id: string) {
    return this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data: {
        disabled: true,
      },
    });
  }

  enableChannel(org: string, id: string) {
    return this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data: {
        disabled: false,
      },
    });
  }

  enableChannels(org: string, ids: string[]) {
    return this._integration.model.integration.updateMany({
      where: {
        id: { in: ids },
        organizationId: org,
        deletedAt: null,
      },
      data: {
        disabled: false,
      },
    });
  }

  getPostsForChannel(org: string, id: string) {
    return this._posts.model.post.groupBy({
      by: ['group'],
      where: {
        organizationId: org,
        integrationId: id,
        deletedAt: null,
      },
    });
  }

  // The row stays so old posts keep their channel, but the tokens go: nothing
  // reads a deleted channel's tokens, and reconnecting creates a new row.
  deleteChannel(org: string, id: string) {
    // updateMany: an id outside the org matches nothing instead of throwing.
    return this._integration.model.integration.updateMany({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
      },
      data: {
        deletedAt: new Date(),
        token: '',
        refreshToken: null,
        tokenExpiration: null,
      },
    });
  }

  async checkForDeletedOnceAndUpdate(org: string, page: string) {
    return this._integration.model.integration.updateMany({
      where: {
        organizationId: org,
        internalId: page,
        deletedAt: {
          not: null,
        },
      },
      data: {
        internalId: makeId(10),
      },
    });
  }

  // Over the cap after a downgrade: switch off the most recently connected
  // channels and keep the ones the customer connected first (usually their
  // main ones). Without an order the database picked any N — a Business ->
  // Starter downgrade switched off Facebook, Instagram and LinkedIn and kept
  // TikTok, Mastodon and Bluesky (P2b #5, 2026-10-02).
  async disableIntegrations(org: string, totalChannels: number) {
    const getChannels = await this._integration.model.integration.findMany({
      where: {
        organizationId: org,
        disabled: false,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: totalChannels,
      select: {
        id: true,
      },
    });

    await this._integration.model.integration.updateMany({
      where: {
        id: {
          in: getChannels.map((channel) => channel.id),
        },
      },
      data: {
        disabled: true,
      },
    });
  }

  getPlugsByIntegrationId(org: string, id: string) {
    return this._plugs.model.plugs.findMany({
      where: {
        organizationId: org,
        integrationId: id,
      },
    });
  }

  createOrUpdatePlug(org: string, integrationId: string, body: PlugDto) {
    return this._plugs.model.plugs.upsert({
      where: {
        organizationId: org,
        plugFunction_integrationId: {
          integrationId,
          plugFunction: body.func,
        },
      },
      create: {
        integrationId,
        organizationId: org,
        plugFunction: body.func,
        data: JSON.stringify(body.fields),
        activated: true,
      },
      update: {
        data: JSON.stringify(body.fields),
      },
      select: {
        activated: true,
      },
    });
  }

  // null when the plug isn't this org's — a plain update threw P2025 (500).
  async changePlugActivation(orgId: string, plugId: string, status: boolean) {
    const { count } = await this._plugs.model.plugs.updateMany({
      where: {
        organizationId: orgId,
        id: plugId,
      },
      data: {
        activated: !!status,
      },
    });
    return count ? { id: plugId } : null;
  }

  async loadExisingData(
    methodName: string,
    integrationId: string,
    id: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.findMany({
      where: {
        integrationId,
        methodName,
        value: {
          in: id,
        },
      },
    });
  }

  async saveExisingData(
    methodName: string,
    integrationId: string,
    value: string[]
  ) {
    return this._exisingPlugData.model.exisingPlugData.createMany({
      data: value.map((p) => ({
        integrationId,
        methodName,
        value: p,
      })),
    });
  }

  async getPostingTimes(orgId: string, integrationsId?: string) {
    return this._integration.model.integration.findMany({
      where: {
        ...(integrationsId ? { id: integrationsId } : {}),
        organizationId: orgId,
        disabled: false,
        deletedAt: null,
      },
      select: {
        postingTimes: true,
      },
    });
  }

  // One-off backfill: encrypt any integration tokens still stored as plaintext.
  // Idempotent — already-encrypted rows (marker prefix) are skipped.
  async backfillTokenEncryption(apply = true) {
    const all = await this._integration.model.integration.findMany({
      select: { id: true, token: true, refreshToken: true },
    });

    let updated = 0;
    for (const integration of all) {
      const token = AuthService.encryptIntegrationToken(integration.token);
      const refreshToken = AuthService.encryptIntegrationToken(
        integration.refreshToken
      );

      if (
        token === integration.token &&
        refreshToken === integration.refreshToken
      ) {
        continue;
      }

      updated++;

      if (!apply) {
        continue;
      }

      await this._integration.model.integration.update({
        where: { id: integration.id },
        data: { token, refreshToken },
      });
    }

    return { total: all.length, updated };
  }
}
