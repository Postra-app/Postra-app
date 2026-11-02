import { withLiveSubscription } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/live.subscription';
import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import {
  planLimits,
  pricing,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Role, ShortLinkPreference } from '@prisma/client';
import { Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { normalizeEmail } from '@gitroom/helpers/utils/email.normalize';

// Launch market is the UK: a sign-up without an explicit ?region=pl (straight
// to /auth/register, the mobile app's link, Google) is a UK customer.
export const organizationRegion = (region?: string) =>
  region === 'PL' ? 'PL' : 'UK';

// The two stored columns of a new API key; the admin reads the
// key back through AuthService.apiKeyForDisplay.
const storedApiKey = () => {
  const { apiKey, apiKeyHash } = AuthService.newApiKey();
  return { apiKey, apiKeyHash };
};

@Injectable()
export class OrganizationRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>,
    private _transaction: PrismaTransaction
  ) {}

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    const org = await this._organization.model.organization.create({
      select: {
        id: true,
        apiKey: true,
      },
      data: {
        name: name ? `${name}###${id}` : `Unnamed User###${id}`,
        ...storedApiKey(),
        isTrailing: false,
        subscription: {
          create: {
            totalChannels: 1000000,
            subscriptionTier: 'ULTIMATE',
            isLifetime: true,
            period: 'YEARLY',
          },
        },
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                activated: true,
                email: email
                  ? email.split('@').join(`+${saasName}@`)
                  : `${saasName}+` + makeId(10) + '@postra.co.uk',
                name: name ? `${name}###${id}` : `Unnamed User###${id}`,
                providerName: 'LOCAL',
                password: AuthService.hashPassword(makeSecureId(500)),
                timezone: 0,
              },
            },
          },
        },
      },
    });
    // The enterprise caller gets the key it will send, not the ciphertext.
    return { ...org, apiKey: AuthService.apiKeyForDisplay(org.apiKey) };
  }

  async getOrgByApiKey(api: string) {
    const org = await this._organization.model.organization.findFirst({
      where: {
        OR: [
          { apiKeyHash: AuthService.lookupHash(api) },
          // A row the secrets upgrade has not reached holds the key itself.
          ...(api && !api.startsWith('enc2::') ? [{ apiKey: api, apiKeyHash: null }] : []),
        ],
      },
      include: {
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            // The credit cycle starts here; without it the public API and
            // MCP counted from the time of the request.
            createdAt: true,
            periodAnchor: true,
            deletedAt: true,
          },
        },
      },
    });
    return org && withLiveSubscription(org);
  }

  getCount() {
    return this._organization.model.organization.count();
  }

  /**
   * Only used to resolve an impersonation target.
   *
   * The impersonation branch in the auth middleware calls `next()` and returns
   * before the checks the normal path runs, so without these two conditions a
   * deactivated account, or a seat disabled by a downgrade, came back fully
   * operational — publishing included — as soon as an admin stepped into it
   *. The disabled-seat case is the realistic one: it is exactly the
   * state an admin would be looking into after reconcileTeamSeats.
   */
  async getUserOrg(id: string) {
    const membership = await this._userOrg.model.userOrganization.findFirst({
      where: {
        id,
        disabled: false,
        user: { activated: true },
      },
      select: {
        user: true,
        organization: {
          include: {
            users: {
              select: {
                id: true,
                disabled: true,
                role: true,
                userId: true,
              },
            },
            subscription: {
              select: {
                subscriptionTier: true,
                totalChannels: true,
                isLifetime: true,
                // The AI credit month; without them an
                // impersonated session counted from the time of the request.
                createdAt: true,
                periodAnchor: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
    return (
      membership && {
        ...membership,
        organization: withLiveSubscription(membership.organization),
      }
    );
  }

  getImpersonateUser(name: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: {
        OR: [
          {
            organizationId: {
              contains: name,
            },
          },
          {
            user: {
              OR: [
                {
                  name: {
                    contains: name,
                  },
                },
                {
                  email: {
                    contains: name,
                  },
                },
                {
                  id: {
                    contains: name,
                  },
                },
              ],
            },
          },
        ],
      },
      select: {
        id: true,
        organization: {
          select: {
            id: true,
          },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  }

  endTrialOffer(orgId: string) {
    return this._organization.model.organization.update({
      where: { id: orgId },
      data: { allowTrial: false },
    });
  }

  updateApiKey(orgId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        ...storedApiKey(),
      },
    });
  }

  async getOrgsByUserId(userId: string) {
    const orgs = await this._organization.model.organization.findMany({
      where: {
        users: {
          some: {
            userId,
          },
        },
      },
      include: {
        users: {
          where: {
            userId,
          },
          select: {
            disabled: true,
            role: true,
          },
        },
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
            createdAt: true,
            // The AI credit month follows Stripe's billing anchor.
            periodAnchor: true,
            deletedAt: true,
          },
        },
      },
    });
    return orgs.map(withLiveSubscription);
  }

  async getOrgById(id: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id,
      },
    });
  }

  // Active membership row for (user, org), or null. Used to authorize the
  // OAuth connect callback against the session user (see no.auth controller).
  // The membership of a session that is still good: the user is active, not
  // suspended, and the token's version is the current one (a logout
  // everywhere, a password change or a suspension bumps it).
  getSessionMembership(
    userId: string,
    organizationId: string,
    tokenVersion: number
  ) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        disabled: false,
        user: { activated: true, suspendedAt: null, tokenVersion },
      },
    });
  }

  getUserOrgMembership(userId: string, organizationId: string) {
    return this._userOrg.model.userOrganization.findFirst({
      where: {
        userId,
        organizationId,
        disabled: false,
      },
    });
  }

  async addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    const checkIfInviteExists = await this._user.model.user.findFirst({
      where: {
        inviteId: id,
      },
    });

    if (checkIfInviteExists) {
      return false;
    }


    // Already a member? The guard above only asks whether *this invite* has
    // been redeemed, so a second invite carries a different id, sails past it
    // and lands on the (userId, organizationId) unique constraint — an
    // unhandled 500. That is an ordinary situation:
    // someone says the mail never arrived, you send another, they click both.
    // Answer it the same way as a spent invite rather than letting the
    // database raise.
    const alreadyMember =
      await this._userOrg.model.userOrganization.findFirst({
        where: {
          userId,
          organizationId: orgId,
        },
      });

    if (alreadyMember) {
      return false;
    }

    const checkForSubscription =
      await this._organization.model.organization.findFirst({
        where: {
          id: orgId,
        },
        select: {
          subscription: true,
          isTrailing: true,
        },
      });

    // Seats are checked when an invite is sent, but sending one reserves
    // nothing: a Pro owner could send several and every one of them got in.
    // The plan's seats are counted again on joining.
    const tier: keyof typeof pricing =
      checkForSubscription?.subscription?.subscriptionTier ||
      (process.env.STRIPE_PUBLISHABLE_KEY ? 'FREE' : 'ULTIMATE');
    const seats = planLimits(
      tier,
      !!process.env.STRIPE_PUBLISHABLE_KEY && checkForSubscription?.isTrailing
    ).team_members;

    // The spent mark above lives in one field of the user who used the
    // invite, so their next invite overwrote it and the first link worked
    // again — for anyone, with the role it carried. One atomic
    // claim per invite, kept well past the link's one-hour life; two people
    // using one link at once cannot both get in either. Claimed only here, once
    // nothing else refuses the join, and released if the write fails.
    const claimed = await ioRedis.set(
      `invite-used:${id}`,
      userId,
      'EX',
      7 * 24 * 60 * 60,
      'NX'
    );
    if (!claimed) {
      return false;
    }

    let create;
    try {
      // Counted and written under the organisation's lock, so two invites
      // accepted at once cannot both take the last seat.
      create = await this._transaction.model.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`;
        const active = await tx.userOrganization.count({
          where: { organizationId: orgId, disabled: false },
        });
        // Billing off: no seat limits anywhere, as when inviting.
        if (process.env.STRIPE_PUBLISHABLE_KEY && active >= seats) {
          return null;
        }
        return tx.userOrganization.create({
          data: {
            role,
            userId,
            organizationId: orgId,
          },
        });
      });
    } catch (err) {
      await ioRedis.del(`invite-used:${id}`);
      throw err;
    }
    if (!create) {
      await ioRedis.del(`invite-used:${id}`);
      // Told apart from a spent or invalid invite: the person can do
      // something about it (ask the owner), unlike an expired link.
      return 'no_seats' as const;
    }

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        inviteId: id,
      },
    });

    return create;
  }

  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    hasEmail: boolean,
    ip: string,
    userAgent: string
  ) {
    return this._organization.model.organization.create({
      data: {
        name: body.company,
        ...storedApiKey(),
        allowTrial: true,
        isTrailing: true,
        region: organizationRegion(body.region),
        users: {
          create: {
            role: Role.SUPERADMIN,
            user: {
              create: {
                activated: body.provider !== 'LOCAL' || !hasEmail,
                email: body.email,
                emailNormalized: normalizeEmail(body.email),
                password: body.password
                  ? AuthService.hashPassword(body.password)
                  : '',
                providerName: body.provider,
                providerId: body.providerId || '',
                timezone: 0,
                ip,
                agent: userAgent,
                // /auth/register validated the ToS checkbox (CreateOrgUserDto
                // @Equals(true)) before this runs — both LOCAL and OAuth paths.
                termsAcceptedAt: new Date(),
              },
            },
          },
        },
      },
      select: {
        id: true,
        users: {
          select: {
            user: true,
          },
        },
      },
    });
  }

  getOrgByCustomerId(customerId: string) {
    return this._organization.model.organization.findFirst({
      where: {
        paymentId: customerId,
      },
    });
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    try {
      await this._organization.model.organization.update({
        where: {
          id: organizationId,
          ...(type === 'start'
            ? {
                streakSince: null,
              }
            : {}),
        },
        data: {
          ...(type === 'end' ? { streakSince: null } : {}),
          ...(type === 'start' ? { streakSince: new Date() } : {}),
        },
      });
    } catch (err) {}
  }

  // The newest published post, never in the future: the streak workflow sleeps
  // until a day after it. Deleted posts do not keep a streak alive.
  async getLastPublishDate(organizationId: string) {
    const org = await this._organization.model.organization.findUnique({
      where: { id: organizationId },
      select: {
        post: {
          where: { state: 'PUBLISHED', deletedAt: null },
          orderBy: { publishDate: 'desc' },
          take: 1,
          select: { publishDate: true },
        },
      },
    });
    const publishDate = org?.post?.[0]?.publishDate;
    return publishDate ? Math.min(publishDate.getTime(), Date.now()) : null;
  }

  async getTeam(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          select: {
            role: true,
            // The seat counter and the role controls read it: a seat turned
            // off by a downgrade is not used and cannot take ownership.
            disabled: true,
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
              },
            },
          },
        },
      },
    });
  }

  // Who gets the organisation's mail. A seat disabled by a downgrade, or a
  // suspended account, kept receiving it, failure mails with post content
  // included.
  getAllUsersOrgs(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        users: {
          where: { disabled: false, user: { suspendedAt: null } },
          select: {
            user: {
              select: {
                email: true,
                id: true,
                sendSuccessEmails: true,
                sendFailureEmails: true,
              },
            },
          },
        },
      },
    });
  }

  disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        role: {
          not: Role.SUPERADMIN,
        },
      },
      data: {
        disabled: disable,
      },
    });
  }

  // The user ids the toggle above affects — used to invalidate their cached
  // auth-context so a disable/enable takes effect immediately, not after the
  // cache TTL.
  async getNonSuperAdminMemberIds(orgId: string): Promise<string[]> {
    const rows = await this._userOrg.model.userOrganization.findMany({
      where: {
        organizationId: orgId,
        role: {
          not: Role.SUPERADMIN,
        },
      },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  // Role changes, the hand-over and removals read the current roles and write
  // under the organisation's lock, in one transaction (Codex 2 XI). Checked
  // first and written later, "Make owner" and "make them a user" sent at once
  // both passed and the second demoted the new owner; two co-owners removing
  // each other both passed too: no owner left. The caller's role is read here
  // as well, not taken from the 30 s auth cache, so a former owner's open tab
  // cannot act as the owner.
  private lockedTeamChange<T>(
    orgId: string,
    actorId: string,
    targetId: string,
    change: (
      tx: Parameters<Parameters<PrismaTransaction['model']['$transaction']>[0]>[0],
      actor: { role: Role } | null,
      target: { role: Role; disabled: boolean; user: { suspendedAt: Date | null } } | null
    ) => Promise<T>
  ) {
    return this._transaction.model.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${orgId} FOR UPDATE`;
      const membership = (userId: string) =>
        tx.userOrganization.findUnique({
          where: { userId_organizationId: { userId, organizationId: orgId } },
          select: { role: true, disabled: true, user: { select: { suspendedAt: true } } },
        });
      return change(tx, await membership(actorId), await membership(targetId));
    });
  }

  changeMemberRole(
    orgId: string,
    actorId: string,
    targetId: string,
    role: 'USER' | 'ADMIN' | 'OWNER'
  ): Promise<
    | { ok: true; from: Role }
    | { ok: false; reason: 'not-owner' | 'self' | 'not-member' | 'already-owner' | 'unavailable' }
  > {
    return this.lockedTeamChange(orgId, actorId, targetId, async (tx, actor, target) => {
      if (actor?.role !== Role.SUPERADMIN) return { ok: false, reason: 'not-owner' } as const;
      if (actorId === targetId) return { ok: false, reason: 'self' } as const;
      if (!target) return { ok: false, reason: 'not-member' } as const;
      const where = (userId: string) => ({
        userId_organizationId: { userId, organizationId: orgId },
      });
      if (role === 'OWNER') {
        if (target.role === Role.SUPERADMIN) return { ok: false, reason: 'already-owner' } as const;
        // A turned-off seat cannot use the organisation and a suspended
        // account cannot sign in: either would leave no owner who can act.
        if (target.disabled || target.user.suspendedAt) {
          return { ok: false, reason: 'unavailable' } as const;
        }
        await tx.userOrganization.update({ where: where(targetId), data: { role: Role.SUPERADMIN } });
        await tx.userOrganization.update({ where: where(actorId), data: { role: Role.ADMIN } });
      } else if (target.role !== role) {
        await tx.userOrganization.update({ where: where(targetId), data: { role } });
      }
      return { ok: true, from: target.role } as const;
    });
  }

  removeMember(
    orgId: string,
    actorId: string,
    targetId: string
  ): Promise<{ ok: true } | { ok: false; reason: 'not-member' | 'forbidden' | 'last-owner' }> {
    const level = (role?: Role) =>
      role === Role.SUPERADMIN ? 2 : role === Role.ADMIN ? 1 : 0;
    return this.lockedTeamChange(orgId, actorId, targetId, async (tx, actor, target) => {
      if (!target) return { ok: false, reason: 'not-member' } as const;
      if (!actor || level(actor.role) < level(target.role)) {
        return { ok: false, reason: 'forbidden' } as const;
      }
      if (target.role === Role.SUPERADMIN) {
        const owners = await tx.userOrganization.count({
          where: { organizationId: orgId, role: Role.SUPERADMIN, disabled: false },
        });
        // The owner removing themselves (or the last other owner) left the
        // team with nobody who can manage members or billing.
        if (owners <= 1) return { ok: false, reason: 'last-owner' } as const;
      }
      // Apps they approved for this organisation leave with them.
      await tx.oAuthAuthorization.updateMany({
        where: { organizationId: orgId, userId: targetId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.userOrganization.delete({
        where: { userId_organizationId: { userId: targetId, organizationId: orgId } },
      });
      return { ok: true } as const;
    });
  }

  getActiveMemberCount(orgId: string) {
    return this._userOrg.model.userOrganization.count({
      where: { organizationId: orgId, disabled: false },
    });
  }

  getMembersForSeatReconcile(orgId: string) {
    return this._userOrg.model.userOrganization.findMany({
      where: { organizationId: orgId },
      select: { userId: true, role: true, disabled: true, createdAt: true },
    });
  }

  setMembersDisabled(orgId: string, userIds: string[], disabled: boolean) {
    return this._userOrg.model.userOrganization.updateMany({
      where: {
        organizationId: orgId,
        userId: { in: userIds },
        // Never disable the owner — the seat cap always keeps SUPERADMIN.
        role: { not: Role.SUPERADMIN },
      },
      data: { disabled },
    });
  }

  getShortlinkPreference(orgId: string) {
    return this._organization.model.organization.findUnique({
      where: {
        id: orgId,
      },
      select: {
        shortlink: true,
      },
    });
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        shortlink,
      },
    });
  }
}
