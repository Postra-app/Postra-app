import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Role, ShortLinkPreference, SubscriptionTier } from '@prisma/client';
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

@Injectable()
export class OrganizationRepository {
  constructor(
    private _organization: PrismaRepository<'organization'>,
    private _userOrg: PrismaRepository<'userOrganization'>,
    private _user: PrismaRepository<'user'>,
    private _oauthAuth: PrismaRepository<'oAuthAuthorization'>
  ) {}

  createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organization.model.organization.create({
      select: {
        id: true,
        apiKey: true,
      },
      data: {
        name: name ? `${name}###${id}` : `Unnamed User###${id}`,
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
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
                  : `${saasName}+` + makeId(10) + '@postra.pl',
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
  }

  getOrgByApiKey(api: string) {
    return this._organization.model.organization.findFirst({
      where: {
        apiKey: api,
      },
      include: {
        subscription: {
          select: {
            subscriptionTier: true,
            totalChannels: true,
            isLifetime: true,
          },
        },
      },
    });
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
  getUserOrg(id: string) {
    return this._userOrg.model.userOrganization.findFirst({
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
              },
            },
          },
        },
      },
    });
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

  updateApiKey(orgId: string) {
    return this._organization.model.organization.update({
      where: {
        id: orgId,
      },
      data: {
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
      },
    });
  }

  async getOrgsByUserId(userId: string) {
    return this._organization.model.organization.findMany({
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
          },
        },
      },
    });
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

    // The spent mark above lives in one field of the user who used the
    // invite, so their next invite overwrote it and the first link worked
    // again — for anyone, with the role it carried (E2E-02-31). One atomic
    // claim per invite, kept well past the link's one-hour life; two people
    // using one link at once cannot both get in either.
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
        },
      });

    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      checkForSubscription?.subscription?.subscriptionTier ===
        SubscriptionTier.STANDARD
    ) {
      return false;
    }

    const create = await this._userOrg.model.userOrganization.create({
      data: {
        role,
        userId,
        organizationId: orgId,
      },
    });

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
        apiKey: AuthService.fixedEncryption(makeSecureId(20)),
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

  async deleteTeamMember(orgId: string, userId: string) {
    // Apps they approved for this organisation leave with them.
    await this._oauthAuth.model.oAuthAuthorization.updateMany({
      where: { organizationId: orgId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return this._userOrg.model.userOrganization.delete({
      where: {
        userId_organizationId: {
          userId,
          organizationId: orgId,
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
