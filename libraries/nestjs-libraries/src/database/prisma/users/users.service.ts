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
  // obligation, not a tidy-up (E2E-09-58).
  async deleteAccount(userId: string) {
    const soleOrgIds = await this.getSoleOwnedOrganizations(userId);

    // Collected before the delete: the rows cascade away with the org, and
    // then there is nothing left to say which objects were theirs.
    const media = soleOrgIds.length
      ? await this._prisma.media.findMany({
          where: { organizationId: { in: soleOrgIds } },
          select: { path: true, thumbnail: true },
        })
      : [];

    await this._prisma.$transaction(async (tx) => {
      for (const id of soleOrgIds) {
        await tx.organization.delete({ where: { id } });
      }

      await tx.user.delete({ where: { id: userId } });
    });

    await this.removeStoredFiles(media);

    return { deleted: true };
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
