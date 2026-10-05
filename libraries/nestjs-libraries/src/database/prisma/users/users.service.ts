import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { Provider } from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Logger } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(
    private _usersRepository: UsersRepository,
    private _organizationRepository: OrganizationRepository,
    private _prisma: PrismaService
  ) {}

  touchLastOnline(id: string) {
    return this._usersRepository.touchLastOnline(id);
  }

  getUserByEmail(email: string) {
    return this._usersRepository.getUserByEmail(email);
  }

  getUserByNormalizedEmail(normalizedEmail: string) {
    return this._usersRepository.getUserByNormalizedEmail(normalizedEmail);
  }

  getUserById(id: string) {
    return this._usersRepository.getUserById(id);
  }

  getImpersonateUser(name: string) {
    return this._organizationRepository.getImpersonateUser(name);
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._usersRepository.getUserByProvider(providerId, provider);
  }

  activateUser(id: string) {
    return this._usersRepository.activateUser(id);
  }

  updatePassword(id: string, password: string) {
    return this._usersRepository.updatePassword(id, password);
  }

  getPersonal(userId: string) {
    return this._usersRepository.getPersonal(userId);
  }

  changePersonal(userId: string, orgId: string, body: UserDetailDto) {
    return this._usersRepository.changePersonal(userId, orgId, body);
  }

  getEmailNotifications(userId: string) {
    return this._usersRepository.getEmailNotifications(userId);
  }

  updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    return this._usersRepository.updateEmailNotifications(userId, body);
  }

  // Organizations that would be deleted together with this user (the user is
  // their only member). The delete endpoint cancels their Stripe subscriptions
  // before deleteAccount runs — the Subscription rows cascade away with the
  // org, so this is the last moment the customer can be looked up.
  async getSoleOwnedOrganizations(userId: string) {
    const memberships = await this._prisma.userOrganization.findMany({
      where: { userId },
      select: { organizationId: true },
    });

    const soleOrgIds: string[] = [];
    for (const { organizationId } of memberships) {
      const members = await this._prisma.userOrganization.count({
        where: { organizationId },
      });
      if (members <= 1) {
        soleOrgIds.push(organizationId);
      }
    }

    return soleOrgIds;
  }

  // GDPR / RODO right to erasure + Meta data-deletion requirement.
  // Hard-deletes the user and every organization the user solely owns. DB-level
  // ON DELETE CASCADE removes all org children (integrations + OAuth tokens,
  // posts, media, comments, ...). Organizations shared with other members are
  // kept; the user is simply detached (their UserOrganization row cascades away
  // when the user is deleted). See Plan/app_review.md §1B (B2).
  // MobilePushToken cascades from both User and Organization (schema.prisma);
  // an older comment here said it did not.
  //
  // The database rows were only ever half of it. The files themselves stayed in
  // the bucket and stayed publicly readable through the CDN, because removeFile
  // is implemented three times over and was called from nowhere: after someone
  // exercised their right to erasure, every photo and video they had uploaded
  // was still a working URL. Postra is registered with the ICO, so that is an
  // obligation, not a tidy-up.
  async deleteAccount(userId: string) {
    const soleOrgIds = await this.getSoleOwnedOrganizations(userId);

    // Collected before the delete: the rows cascade away with the org, and
    // then there is nothing left to say which objects were theirs.
    const media = soleOrgIds.length
      ? await this._prisma.media.findMany({
          where: { organizationId: { in: soleOrgIds } },
          select: { path: true, thumbnail: true, organizationId: true },
        })
      : [];

    const deletedOrgIds = new Set<string>();
    await this._prisma.$transaction(async (tx) => {
      for (const id of soleOrgIds) {
        // Counted again under the organisation's row lock: someone accepting
        // an invitation between the first count and here had their new
        // membership, posts and channels deleted with the org (AUTH-1). A
        // membership insert holds a key lock on this row, so the two wait
        // for each other.
        await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${id} FOR UPDATE`;
        const members = await tx.userOrganization.count({
          where: { organizationId: id },
        });
        if (members > 1) continue;
        await tx.organization.delete({ where: { id } });
        deletedOrgIds.add(id);
      }

      await tx.user.delete({ where: { id: userId } });
    });

    await this.removeStoredFiles(
      media.filter((m) => deletedOrgIds.has(m.organizationId))
    );

    return { deleted: true };
  }

  /**
   * Everything Postra holds about one person, as JSON — the answer to a
   * subject access request (UK GDPR art. 15) and a portable copy (art. 20).
   *
   * An organisation the person owns alone is theirs, so its channels, posts,
   * media and settings come with it. In an organisation shared with others
   * only the membership and their own comments are theirs to receive; the
   * rest belongs to the team. Secrets never leave: no password hash, no
   * channel or OAuth tokens, no session version.
   */
  async exportUserData(userId: string) {
    const user = await this._prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        lastName: true,
        bio: true,
        timezone: true,
        providerName: true,
        createdAt: true,
        activated: true,
        termsAcceptedAt: true,
        lastOnline: true,
        sendSuccessEmails: true,
        sendFailureEmails: true,
        suspendedAt: true,
        suspendedReason: true,
      },
    });
    if (!user) {
      return null;
    }

    const memberships = await this._prisma.userOrganization.findMany({
      where: { userId },
      select: {
        role: true,
        createdAt: true,
        organization: { select: { id: true, name: true, createdAt: true } },
      },
    });
    const soleOrgIds = new Set(await this.getSoleOwnedOrganizations(userId));

    const organizations = [];
    for (const { role, createdAt, organization } of memberships) {
      const id = organization.id;
      const entry: Record<string, unknown> = {
        id,
        name: organization.name,
        role,
        memberSince: createdAt,
        ownedAlone: soleOrgIds.has(id),
      };
      if (soleOrgIds.has(id)) {
        const where = { organizationId: id };
        Object.assign(entry, {
          subscription: await this._prisma.subscription.findFirst({
            where,
            select: { subscriptionTier: true, period: true, totalChannels: true, createdAt: true, cancelAt: true },
          }),
          channels: await this._prisma.integration.findMany({
            where,
            select: { id: true, name: true, providerIdentifier: true, profile: true, disabled: true, createdAt: true, deletedAt: true },
          }),
          posts: await this._prisma.post.findMany({
            where,
            select: { id: true, group: true, integrationId: true, content: true, image: true, state: true, publishDate: true, releaseURL: true, createdAt: true, deletedAt: true },
            orderBy: { createdAt: 'asc' },
          }),
          media: await this._prisma.media.findMany({
            where,
            select: { id: true, name: true, path: true, type: true, alt: true, aiGenerated: true, createdAt: true, deletedAt: true },
          }),
          signatures: await this._prisma.signatures.findMany({ where, select: { content: true, autoAdd: true, createdAt: true } }),
          sets: await this._prisma.sets.findMany({ where, select: { name: true, content: true, createdAt: true } }),
          webhooks: await this._prisma.webhooks.findMany({ where, select: { name: true, url: true, createdAt: true, deletedAt: true } }),
          autoPosts: await this._prisma.autoPost.findMany({ where, select: { title: true, url: true, active: true, createdAt: true, deletedAt: true } }),
          brandKit: await this._prisma.brandKit.findFirst({
            where,
            select: { logoPath: true, primaryColor: true, secondaryColor: true, textColor: true, font: true, tone: true },
          }),
          notifications: await this._prisma.notifications.findMany({ where, select: { content: true, link: true, createdAt: true } }),
          aiUsage: await this._prisma.aiUsage.findMany({
            where,
            select: { engine: true, model: true, unit: true, inputAmount: true, outputAmount: true, createdAt: true },
          }),
        });
      }
      organizations.push(entry);
    }

    return {
      format: 'postra-personal-data-v1',
      exportedAt: new Date().toISOString(),
      user,
      organizations,
      comments: await this._prisma.comments.findMany({
        where: { userId },
        select: { organizationId: true, postId: true, content: true, createdAt: true, deletedAt: true },
      }),
      approvedApps: await this._prisma.oAuthAuthorization.findMany({
        where: { userId },
        select: { organizationId: true, createdAt: true, revokedAt: true, oauthApp: { select: { name: true } } },
      }),
      mobileDevices: await this._prisma.mobilePushToken.findMany({
        where: { userId },
        select: { platform: true, createdAt: true },
      }),
      securityLog: await this._prisma.auditLog.findMany({
        where: { userId },
        select: { action: true, ip: true, userAgent: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
    };
  }

  /**
   * Delete one organization and nothing else.
   *
   * Account deletion removes the organizations a user solely owns; this is the
   * other half an operator needs — a customer who wants one workspace gone, or
   * an organization created by mistake — without touching anybody's login.
   * Members simply lose the membership, which cascades with the organization.
   *
   * The media objects are collected before the delete for the same reason as
   * in deleteAccount: afterwards no row remembers which files were theirs, and
   * the bucket keeps serving them through the CDN.
   */
  async deleteOrganization(organizationId: string) {
    const media = await this._prisma.media.findMany({
      where: { organizationId },
      select: { path: true, thumbnail: true },
    });

    await this._prisma.organization.delete({ where: { id: organizationId } });

    await this.removeStoredFiles(media);

    return { mediaRemoved: media.length };
  }

  /**
   * Best-effort removal of the objects behind deleted media rows.
   *
   * Deliberately after the transaction and never inside it: the database delete
   * is the erasure that must not be rolled back by a storage hiccup. A file the
   * bucket no longer has is not an error — the same object can be referenced by
   * a row and its thumbnail.
   */
  private async removeStoredFiles(
    media: { path: string; thumbnail: string | null }[]
  ) {
    const paths = [
      ...new Set(
        media.flatMap((m) => [m.path, m.thumbnail]).filter(Boolean) as string[]
      ),
    ];

    if (!paths.length) {
      return;
    }

    const storage = UploadFactory.createStorage();
    let failed = 0;
    for (const path of paths) {
      try {
        await storage.removeFile(path);
      } catch {
        failed++;
      }
    }

    if (failed) {
      Logger.warn(
        `deleteAccount: ${failed}/${paths.length} stored file(s) could not be removed`
      );
    }
  }
}
