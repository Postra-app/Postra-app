import { Injectable } from '@nestjs/common';
import { UsersRepository } from '@gitroom/nestjs-libraries/database/prisma/users/users.repository';
import { Provider } from '@prisma/client';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

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
  // NOTE: MobilePushToken (mobile companion) has no FK relation, so it is not
  // cascaded. When the mobile push feature ships, give it an onDelete: Cascade
  // relation to User, or delete it here.
  async deleteAccount(userId: string) {
    const soleOrgIds = await this.getSoleOwnedOrganizations(userId);

    await this._prisma.$transaction(async (tx) => {
      for (const id of soleOrgIds) {
        await tx.organization.delete({ where: { id } });
      }

      await tx.user.delete({ where: { id: userId } });
    });

    return { deleted: true };
  }
}
