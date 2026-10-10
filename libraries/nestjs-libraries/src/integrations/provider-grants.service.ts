import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/meta.graph.version';

/**
 * Takes back Postra's access at the platform when an account is deleted
 * (E2E-09-66).
 *
 * Deleting the rows destroys our copy of the tokens, but the grant itself
 * stays with the platform: Postra kept appearing in the person's Facebook
 * "Business integrations", Google "Third-party access" and so on until they
 * removed it by hand.
 *
 * A grant belongs to the person's platform account, not to one channel:
 * revoking it for one Facebook Page cuts every Page and Instagram account
 * that came through the same Facebook login. So a grant is revoked only when
 * nothing left in Postra still uses that platform account, and only on
 * account or organisation deletion, never when a single channel is removed.
 * Best effort: the erasure has happened by then and does not wait on a
 * platform's answer.
 */

export interface ProviderGrant {
  providerIdentifier: string;
  internalId: string;
  rootInternalId: string | null;
  token: string;
  refreshToken: string | null;
}

type Revoke = (grant: ProviderGrant) => Promise<Response>;

const TIMEOUT_MS = 10_000;

const form = (fields: Record<string, string>) =>
  new URLSearchParams(fields).toString();

const post = (url: string, fields: Record<string, string>) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form(fields),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

// One entry per platform login. Providers in the same family share one grant.
const FAMILIES: Record<string, { providers: string[]; revoke: Revoke }> = {
  meta: {
    providers: ['facebook', 'instagram'],
    // The Page token cannot speak for the person; the user token we keep as
    // the refresh token, with the Facebook user id as the root, can.
    revoke: ({ rootInternalId, refreshToken }) =>
      fetch(
        `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${rootInternalId}/permissions?access_token=${encodeURIComponent(
          refreshToken || ''
        )}`,
        { method: 'DELETE', signal: AbortSignal.timeout(TIMEOUT_MS) }
      ),
  },
  // Two LinkedIn apps: profiles and Pages each have their own client and
  // their own grant (Codex review 10-10).
  linkedin: {
    providers: ['linkedin'],
    revoke: ({ token }) =>
      post('https://www.linkedin.com/oauth/v2/revoke', {
        client_id: process.env.LINKEDIN_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_CLIENT_SECRET || '',
        token,
      }),
  },
  'linkedin-page': {
    providers: ['linkedin-page'],
    revoke: ({ token }) =>
      post('https://www.linkedin.com/oauth/v2/revoke', {
        client_id: process.env.LINKEDIN_PAGE_CLIENT_ID || '',
        client_secret: process.env.LINKEDIN_PAGE_CLIENT_SECRET || '',
        token,
      }),
  },
  google: {
    providers: ['youtube'],
    // Revoking the refresh token ends the whole grant.
    revoke: ({ token, refreshToken }) =>
      post('https://oauth2.googleapis.com/revoke', {
        token: refreshToken || token,
      }),
  },
  tiktok: {
    providers: ['tiktok'],
    revoke: ({ token }) =>
      post('https://open.tiktokapis.com/v2/oauth/revoke/', {
        client_key: process.env.TIKTOK_CLIENT_ID || '',
        client_secret: process.env.TIKTOK_CLIENT_SECRET || '',
        token,
      }),
  },
};

const familyOf = (providerIdentifier: string) =>
  Object.entries(FAMILIES).find(([, f]) =>
    f.providers.includes(providerIdentifier)
  );

// The platform account a grant belongs to.
const accountOf = (grant: Pick<ProviderGrant, 'internalId' | 'rootInternalId'>) =>
  grant.rootInternalId || grant.internalId;

@Injectable()
export class ProviderGrantsService {
  constructor(private _prisma: PrismaService) {}

  /** The grants behind these organisations' channels, read before they go. */
  async collect(organizationIds: string[]): Promise<ProviderGrant[]> {
    if (!organizationIds.length) {
      return [];
    }
    const providers = Object.values(FAMILIES).flatMap((f) => f.providers);
    const rows = await this._prisma.integration.findMany({
      where: {
        organizationId: { in: organizationIds },
        providerIdentifier: { in: providers },
      },
      select: {
        providerIdentifier: true,
        internalId: true,
        rootInternalId: true,
        token: true,
        refreshToken: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      token: AuthService.decryptIntegrationToken(row.token),
      refreshToken: AuthService.decryptIntegrationToken(row.refreshToken),
    }));
  }

  /**
   * Revoke each platform account's grant once, unless a channel that is
   * still in Postra uses the same account. Call after the rows are deleted.
   */
  async revokeUnused(grants: ProviderGrant[]) {
    const seen = new Set<string>();
    for (const grant of grants) {
      const family = familyOf(grant.providerIdentifier);
      if (!family) {
        continue;
      }
      const [name, { providers, revoke }] = family;
      const account = accountOf(grant);
      const key = `${name}:${account}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);

      // "Could not tell" counts as still used: a wrongly kept grant costs
      // nothing, a wrongly revoked one breaks somebody's channels.
      const stillUsed = await this._prisma.integration
        .count({
          where: {
            deletedAt: null,
            providerIdentifier: { in: providers },
            OR: [{ rootInternalId: account }, { internalId: account }],
          },
        })
        .catch(() => 1);
      if (stillUsed) {
        Logger.log(`[revoke] ${name}: kept, the account is still connected elsewhere`);
        continue;
      }

      try {
        const res = await revoke(grant);
        Logger.log(`[revoke] ${name}: ${res.ok ? 'revoked' : `refused (${res.status})`}`);
      } catch (err: any) {
        Logger.warn(`[revoke] ${name}: failed (${err?.name || 'error'})`);
      }
    }
  }
}
