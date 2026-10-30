import { Injectable } from '@nestjs/common';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import {
  currentSecretPrefix,
  LOOKUP_MARKER,
} from '@gitroom/helpers/auth/secrets-at-rest';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

/**
 * Rewrites secrets stored in the legacy format (fixed-IV AES-CBC under
 * JWT_SECRET) into the current one (secrets-at-rest.ts): values
 * the app reads back become enc2:: ciphertext under the key that encrypts
 * now (also after a rotation), values it only compares become their SHA-256.
 * Runs at every backend start, after listen: rows already in the current
 * form are not selected, so once everything is upgraded it is a handful of
 * empty queries.
 *
 * Each row is written only if it still holds what was read (updateMany on the
 * old value), so a token refreshed in the meantime, or a second instance
 * doing the same, is never overwritten. With an organisation id it touches
 * that organisation's rows only (the stack test, beside other specs).
 */
@Injectable()
export class SecretsUpgradeService {
  constructor(private _prisma: PrismaService) {}

  async run(organizationId?: string) {
    const scope = organizationId ? { organizationId } : {};
    return {
      integrations: await this.integrations(scope),
      webhooks: await this.webhooks(scope),
      thirdParty: await this.thirdParty(scope),
      organizations: await this.organizations(
        organizationId ? { id: organizationId } : {}
      ),
      oauthApps: await this.oauthApps(scope),
      oauthAuthorizations: await this.oauthAuthorizations(scope),
    };
  }

  // Token and refresh token: enc:: legacy or plaintext; custom instance
  // details: bare legacy hex.
  private async integrations(scope: { organizationId?: string }) {
    const current = currentSecretPrefix();
    const rows = await this._prisma.integration.findMany({
      where: {
        ...scope,
        OR: [
          { token: { not: '' }, NOT: { token: { startsWith: current } } },
          {
            refreshToken: { not: '' },
            NOT: { refreshToken: { startsWith: current } },
          },
          {
            customInstanceDetails: { not: '' },
            NOT: { customInstanceDetails: { startsWith: current } },
          },
        ],
      },
      select: {
        id: true,
        token: true,
        refreshToken: true,
        customInstanceDetails: true,
      },
    });

    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        // A field this cannot read stays as it is, without holding the
        // tokens back; the row is counted as failed.
        let detailsUnread = false;
        let customInstanceDetails = row.customInstanceDetails;
        if (customInstanceDetails) {
          try {
            customInstanceDetails = reencryptDetails(customInstanceDetails);
          } catch {
            detailsUnread = true;
          }
        }
        const { count } = await this._prisma.integration.updateMany({
          where: {
            id: row.id,
            token: row.token,
            refreshToken: row.refreshToken,
            customInstanceDetails: row.customInstanceDetails,
          },
          data: {
            token: reencryptToken(row.token)!,
            refreshToken: reencryptToken(row.refreshToken),
            customInstanceDetails,
          },
        });
        updated += count;
        failed += detailsUnread ? 1 : 0;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }

  private async webhooks(scope: { organizationId?: string }) {
    const current = currentSecretPrefix();
    const rows = await this._prisma.webhooks.findMany({
      where: {
        ...scope,
        secret: { not: '' },
        NOT: { secret: { startsWith: current } },
      },
      select: { id: true, secret: true },
    });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const { count } = await this._prisma.webhooks.updateMany({
          where: { id: row.id, secret: row.secret },
          data: { secret: reencryptToken(row.secret) },
        });
        updated += count;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }

  private async thirdParty(scope: { organizationId?: string }) {
    const current = currentSecretPrefix();
    const rows = await this._prisma.thirdParty.findMany({
      where: { ...scope, NOT: { apiKey: { startsWith: current } } },
      select: { id: true, apiKey: true },
    });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const { count } = await this._prisma.thirdParty.updateMany({
          where: { id: row.id, apiKey: row.apiKey },
          data: { apiKey: reencrypt(row.apiKey) },
        });
        updated += count;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }

  // A legacy row has no hash and holds the key the admin uses, as is; a
  // current one may be under a key that no longer encrypts.
  private async organizations(scope: { id?: string }) {
    const rows = await this._prisma.organization.findMany({
      where: {
        ...scope,
        apiKey: { not: null },
        OR: [
          { apiKeyHash: null },
          { NOT: { apiKey: { startsWith: currentSecretPrefix() } } },
        ],
      },
      select: { id: true, apiKey: true, apiKeyHash: true },
    });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const key = row.apiKeyHash
          ? AuthService.decryptSecret(row.apiKey!)
          : row.apiKey!;
        const { count } = await this._prisma.organization.updateMany({
          where: { id: row.id, apiKey: row.apiKey, apiKeyHash: row.apiKeyHash },
          data: {
            apiKey: AuthService.encryptSecret(key),
            apiKeyHash: AuthService.lookupHash(key),
          },
        });
        updated += count;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }

  private async oauthApps(scope: { organizationId?: string }) {
    const rows = await this._prisma.oAuthApp.findMany({
      where: {
        ...scope,
        clientSecret: { not: null },
        NOT: { clientSecret: { startsWith: LOOKUP_MARKER } },
      },
      select: { id: true, clientSecret: true },
    });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const { count } = await this._prisma.oAuthApp.updateMany({
          where: { id: row.id, clientSecret: row.clientSecret },
          data: { clientSecret: rehash(row.clientSecret!) },
        });
        updated += count;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }

  private async oauthAuthorizations(scope: { organizationId?: string }) {
    const rows = await this._prisma.oAuthAuthorization.findMany({
      where: {
        ...scope,
        OR: [
          {
            accessToken: { not: null },
            NOT: { accessToken: { startsWith: LOOKUP_MARKER } },
          },
          {
            authorizationCode: { not: null },
            NOT: { authorizationCode: { startsWith: LOOKUP_MARKER } },
          },
        ],
      },
      select: { id: true, accessToken: true, authorizationCode: true },
    });
    let updated = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const { count } = await this._prisma.oAuthAuthorization.updateMany({
          where: {
            id: row.id,
            accessToken: row.accessToken,
            authorizationCode: row.authorizationCode,
          },
          data: {
            accessToken: row.accessToken && rehash(row.accessToken),
            authorizationCode:
              row.authorizationCode && rehash(row.authorizationCode),
          },
        });
        updated += count;
      } catch {
        // Unreadable under the configured keys: left as it is, counted.
        failed++;
      }
    }
    return { found: rows.length, updated, failed };
  }
}

// A value the app reads back, in the legacy bare-hex form or already current.
const reencrypt = (stored: string) =>
  stored.startsWith(currentSecretPrefix())
    ? stored
    : AuthService.encryptSecret(AuthService.decryptSecret(stored));

// Custom instance details: as reencrypt, plus the signed JWT that Skool
// accounts connected before the at-rest format kept their cookies in
// (SkoolProvider.getCookies still reads it); its claims become the JSON the
// current format holds.
const reencryptDetails = (stored: string) => {
  try {
    return reencrypt(stored);
  } catch (e) {
    const claims = AuthService.verifyJWT(stored);
    if (!claims || typeof claims !== 'object') {
      throw e;
    }
    const details: Record<string, unknown> = { ...claims };
    delete details.iat;
    delete details.exp;
    return AuthService.encryptSecret(JSON.stringify(details));
  }
};

// A token or webhook secret: legacy enc::, plaintext, or under an old key.
const reencryptToken = (stored: string | null) =>
  !stored || stored.startsWith(currentSecretPrefix())
    ? stored
    : AuthService.encryptSecret(AuthService.decryptIntegrationToken(stored));

// A compared value stored as its legacy ciphertext: the hash of what it hid.
const rehash = (stored: string) =>
  stored.startsWith(LOOKUP_MARKER)
    ? stored
    : AuthService.lookupHash(AuthService.decryptSecret(stored));
