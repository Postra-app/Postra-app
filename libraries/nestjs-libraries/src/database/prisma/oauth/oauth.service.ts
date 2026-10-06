import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { OAuthRepository } from '@gitroom/nestjs-libraries/database/prisma/oauth/oauth.repository';
import { CreateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/create-oauth-app.dto';
import { UpdateOAuthAppDto } from '@gitroom/nestjs-libraries/dtos/oauth/update-oauth-app.dto';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { createHash, timingSafeEqual } from 'crypto';

// RFC 7636 §4.6, S256: BASE64URL(SHA256(code_verifier)) == code_challenge.
// No challenge on the code ⇒ no verifier allowed either.
export const pkceMatches = (challenge?: string | null, verifier?: string) => {
  if (!challenge) return !verifier;
  if (!verifier) return false;
  const expected = Buffer.from(
    createHash('sha256').update(verifier).digest('base64url')
  );
  const given = Buffer.from(challenge);
  return expected.length === given.length && timingSafeEqual(expected, given);
};

@Injectable()
export class OAuthService {
  constructor(private _oauthRepository: OAuthRepository) {}

  async getApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) return false;
    const { clientSecret, ...rest } = app;
    return rest;
  }

  async createApp(orgId: string, dto: CreateOAuthAppDto) {
    // One at a time per organisation: two requests at once both saw no app
    // and both created one (API-9).
    const lock = `oauth-app-create:${orgId}`;
    if ((await ioRedis.set(lock, '1', 'EX', 15, 'NX')) !== 'OK') {
      throw new HttpException(
        'You can only have one OAuth application per organization',
        HttpStatus.BAD_REQUEST
      );
    }
    try {
      return await this.createOnlyApp(orgId, dto);
    } finally {
      await ioRedis.del(lock).catch(() => undefined);
    }
  }

  private async createOnlyApp(orgId: string, dto: CreateOAuthAppDto) {
    const existing = await this._oauthRepository.getAppByOrgId(orgId);
    if (existing) {
      throw new HttpException(
        'You can only have one OAuth application per organization',
        HttpStatus.BAD_REQUEST
      );
    }

    await this.refuseForeignPicture(orgId, dto.pictureId);

    const clientId = 'pca_' + makeSecureId(32);
    const clientSecret = 'pcs_' + makeSecureId(48);
    const encryptedSecret = AuthService.fixedEncryption(clientSecret);

    const app = await this._oauthRepository.createApp(orgId, {
      name: dto.name,
      description: dto.description,
      pictureId: dto.pictureId,
      redirectUrl: dto.redirectUrl,
      clientId,
      clientSecret: encryptedSecret,
    });

    return { ...app, clientSecret };
  }

  // The picture is a media id from the client, and the app came back with the
  // whole media record attached: another organisation's id returned its
  // files, Studio design and owner (E2E-08-29).
  private async refuseForeignPicture(orgId: string, pictureId?: string) {
    if (pictureId && !(await this._oauthRepository.ownsMedia(orgId, pictureId))) {
      throw new HttpException('Picture not found', HttpStatus.BAD_REQUEST);
    }
  }

  async updateApp(orgId: string, dto: UpdateOAuthAppDto) {
    await this.refuseForeignPicture(orgId, dto.pictureId);
    return this._oauthRepository.updateApp(orgId, {
      ...(dto.name && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.pictureId !== undefined && { pictureId: dto.pictureId }),
      ...(dto.redirectUrl && { redirectUrl: dto.redirectUrl }),
    });
  }

  async deleteApp(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }
    await this._oauthRepository.revokeAllForApp(app.id);
    await this._oauthRepository.deleteApp(orgId);
    return { success: true };
  }

  async rotateSecret(orgId: string) {
    const app = await this._oauthRepository.getAppByOrgId(orgId);
    if (!app) {
      throw new HttpException('No OAuth app found', HttpStatus.NOT_FOUND);
    }

    const newSecret = 'pcs_' + makeSecureId(48);
    const encrypted = AuthService.fixedEncryption(newSecret);
    await this._oauthRepository.updateClientSecret(orgId, encrypted);
    return { clientSecret: newSecret };
  }

  async validateAuthorizationRequest(clientId: string) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException('Invalid client_id', HttpStatus.BAD_REQUEST);
    }
    return app;
  }

  async createAuthorizationCode(
    oauthAppId: string,
    userId: string,
    organizationId: string,
    codeChallenge?: string
  ) {
    const code = makeSecureId(32);
    const encryptedCode = AuthService.fixedEncryption(code);
    const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await this._oauthRepository.createAuthorization({
      oauthAppId,
      userId,
      organizationId,
      authorizationCode: encryptedCode,
      codeExpiresAt,
      codeChallenge: codeChallenge ?? null,
    });

    return code;
  }

  async exchangeCodeForToken(
    code: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string
  ) {
    const app = await this._oauthRepository.getAppByClientId(clientId);
    if (!app) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    if (app.clientSecret !== AuthService.fixedEncryption(clientSecret)) {
      throw new HttpException(
        { error: 'invalid_client' },
        HttpStatus.UNAUTHORIZED
      );
    }

    const encryptedCode = AuthService.fixedEncryption(code);
    const auth = await this._oauthRepository.findByCode(encryptedCode);
    if (!auth || auth.oauthAppId !== app.id) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    if (!auth.codeExpiresAt || new Date() > auth.codeExpiresAt) {
      throw new HttpException(
        { error: 'invalid_grant', error_description: 'Code has expired' },
        HttpStatus.BAD_REQUEST
      );
    }

    // PKCE: a code asked for with a challenge is only good with its verifier,
    // and a verifier for a code asked for without one is refused too
    // (OAuth 2.1 §4.1.3), so a client never believes it is protected when it
    // is not. The metadata used to promise S256 and nothing checked it
    // (E2E-08-44).
    if (!pkceMatches(auth.codeChallenge, codeVerifier)) {
      throw new HttpException(
        {
          error: 'invalid_grant',
          error_description: 'code_verifier does not match the code_challenge',
        },
        HttpStatus.BAD_REQUEST
      );
    }

    const token = 'pos_' + makeSecureId(40);
    const encryptedToken = AuthService.fixedEncryption(token);
    const spent = await this._oauthRepository.exchangeCodeForToken(
      auth.id,
      encryptedCode,
      encryptedToken
    );
    if (!spent) {
      throw new HttpException(
        { error: 'invalid_grant' },
        HttpStatus.BAD_REQUEST
      );
    }

    // No Stripe customer id here: an outside app has no use for it.
    return {
      id: auth.organizationId,
      access_token: token,
      token_type: 'bearer',
    };
  }

  // A token acts as an admin of its organisation, so it lives only while
  // whoever approved it is one. It used to outlive their removal from the
  // team, a suspension and the app's deletion (E2E-08-25).
  async getOrgByOAuthToken(token: string) {
    const encrypted = AuthService.fixedEncryption(token);
    const authorization = await this._oauthRepository.findByAccessToken(
      encrypted
    );
    if (
      !authorization ||
      authorization.oauthApp.deletedAt ||
      authorization.user.suspendedAt ||
      !authorization.user.organizations.some(
        (membership) =>
          membership.organizationId === authorization.organizationId
      )
    ) {
      return null;
    }
    return authorization;
  }

  async getApprovedApps(userId: string) {
    return this._oauthRepository.getApprovedApps(userId);
  }

  async revokeApp(userId: string, authId: string) {
    const { count } = await this._oauthRepository.revokeAuthorization(
      userId,
      authId
    );
    if (!count) {
      throw new HttpException('Authorization not found', HttpStatus.NOT_FOUND);
    }
    return { success: true };
  }
}
