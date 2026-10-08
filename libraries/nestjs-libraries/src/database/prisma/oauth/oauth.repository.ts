import { withLiveSubscription } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/live.subscription';
import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

@Injectable()
export class OAuthRepository {
  constructor(
    private _oauthApp: PrismaRepository<'oAuthApp'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _media: PrismaRepository<'media'>
  ) {}

  async ownsMedia(orgId: string, mediaId: string) {
    return !!(await this._media.model.media.findFirst({
      where: { id: mediaId, organizationId: orgId, deletedAt: null },
      select: { id: true },
    }));
  }

  getAppByOrgId(orgId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      include: {
        picture: { select: { id: true, path: true } },
      },
    });
  }

  getAppByClientId(clientId: string) {
    return this._oauthApp.model.oAuthApp.findFirst({
      where: {
        clientId,
        deletedAt: null,
      },
      include: {
        picture: { select: { id: true, path: true } },
      },
    });
  }

  createApp(
    orgId: string,
    data: {
      name: string;
      description?: string;
      pictureId?: string;
      redirectUrl: string;
      clientId: string;
      clientSecret: string;
    }
  ) {
    return this._oauthApp.model.oAuthApp.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description,
        pictureId: data.pictureId,
        redirectUrl: data.redirectUrl,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
      },
      include: {
        picture: { select: { id: true, path: true } },
      },
    });
  }

  async updateApp(
    orgId: string,
    data: {
      name?: string;
      description?: string;
      pictureId?: string;
      redirectUrl?: string;
    }
  ) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data,
      include: {
        picture: { select: { id: true, path: true } },
      },
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  async updateClientSecret(orgId: string, newSecret: string) {
    const app = await this._oauthApp.model.oAuthApp.findFirst({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
    if (!app) {
      return null;
    }
    return this._oauthApp.model.oAuthApp.update({
      where: { id: app.id },
      data: {
        clientSecret: newSecret,
      },
    });
  }

  createAuthorization(data: {
    oauthAppId: string;
    userId: string;
    organizationId: string;
    authorizationCode: string;
    codeExpiresAt: Date;
    codeChallenge: string | null;
  }) {
    return this._oauthAuth.model.oAuthAuthorization.upsert({
      where: {
        oauthAppId_userId_organizationId: {
          oauthAppId: data.oauthAppId,
          userId: data.userId,
          organizationId: data.organizationId,
        },
      },
      create: {
        oauthAppId: data.oauthAppId,
        userId: data.userId,
        organizationId: data.organizationId,
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge,
      },
      update: {
        authorizationCode: data.authorizationCode,
        codeExpiresAt: data.codeExpiresAt,
        codeChallenge: data.codeChallenge,
        accessToken: null,
        revokedAt: null,
      },
    });
  }

  findByCode(encryptedCode: string) {
    return this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        authorizationCode: encryptedCode,
        revokedAt: null,
      },
    });
  }

  /**
   * Spends the code in the same write that issues the token. Two exchanges of
   * one code both read it before either wrote, both answered with a token,
   * and the first one stopped working (API-6). Returns 0 when it was spent.
   */
  async exchangeCodeForToken(
    id: string,
    encryptedCode: string,
    encryptedToken: string
  ) {
    const { count } = await this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        id,
        authorizationCode: encryptedCode,
        revokedAt: null,
        codeExpiresAt: { gt: new Date() },
      },
      data: {
        accessToken: encryptedToken,
        authorizationCode: null,
        codeExpiresAt: null,
      },
    });
    return count;
  }

  async findByAccessToken(encryptedToken: string) {
    const authorization = await this._oauthAuth.model.oAuthAuthorization.findFirst({
      where: {
        accessToken: encryptedToken,
        revokedAt: null,
      },
      include: {
        organization: {
          include: {
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
                // The credit cycle starts here; without it the public API and
                // MCP counted from the time of the request (API-7).
                createdAt: true,
                deletedAt: true,
              },
            },
          },
        },
        oauthApp: {
          select: { deletedAt: true },
        },
        user: {
          select: {
            id: true,
            suspendedAt: true,
            organizations: {
              where: { disabled: false, role: { in: ['ADMIN', 'SUPERADMIN'] } },
              select: { organizationId: true },
            },
          },
        },
      },
    });
    return (
      authorization && {
        ...authorization,
        organization: withLiveSubscription(authorization.organization),
      }
    );
  }

  getApprovedApps(userId: string) {
    return this._oauthAuth.model.oAuthAuthorization.findMany({
      where: {
        userId,
        revokedAt: null,
        accessToken: { not: null },
      },
      // What the Approved Apps page shows, nothing more: the full rows carried
      // the app's encrypted client secret and this grant's encrypted access
      // token (AUTH-12).
      select: {
        id: true,
        createdAt: true,
        oauthApp: {
          select: {
            id: true,
            name: true,
            description: true,
            picture: { select: { path: true } },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // updateMany: an id that is not this user's matches nothing (count 0)
  // instead of throwing "record not found" as a 500.
  revokeAuthorization(userId: string, authId: string) {
    return this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        id: authId,
        userId,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revokeAllForApp(oauthAppId: string) {
    return this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: {
        oauthAppId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}
