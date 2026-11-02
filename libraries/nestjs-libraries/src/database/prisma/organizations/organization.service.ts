import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrganizationRepository } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import dayjs from 'dayjs';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { Organization, Role, ShortLinkPreference } from '@prisma/client';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { bustAuthContextCacheForUsers } from '@gitroom/nestjs-libraries/redis/auth-context.cache';

@Injectable()
export class OrganizationService {
  constructor(
    private _organizationRepository: OrganizationRepository,
    private _notificationsService: NotificationService
  ) {}
  async createOrgAndUser(
    body: Omit<CreateOrgUserDto, 'providerToken'> & { providerId?: string },
    ip: string,
    userAgent: string
  ) {
    return this._organizationRepository.createOrgAndUser(
      body,
      this._notificationsService.hasEmailProvider(),
      ip,
      userAgent
    );
  }

  async getCount() {
    return this._organizationRepository.getCount();
  }

  async createMaxUser(id: string, name: string, saasName: string, email: string) {
    return this._organizationRepository.createMaxUser(id, name, saasName, email);
  }

  addUserToOrg(
    userId: string,
    id: string,
    orgId: string,
    role: 'USER' | 'ADMIN'
  ) {
    return this._organizationRepository.addUserToOrg(userId, id, orgId, role);
  }

  getOrgById(id: string) {
    return this._organizationRepository.getOrgById(id);
  }

  getOrgByApiKey(api: string) {
    return this._organizationRepository.getOrgByApiKey(api);
  }

  getSessionMembership(
    userId: string,
    organizationId: string,
    tokenVersion: number
  ) {
    return this._organizationRepository.getSessionMembership(
      userId,
      organizationId,
      tokenVersion
    );
  }

  getUserOrgMembership(userId: string, organizationId: string) {
    return this._organizationRepository.getUserOrgMembership(
      userId,
      organizationId
    );
  }

  getUserOrg(id: string) {
    return this._organizationRepository.getUserOrg(id);
  }

  getOrgsByUserId(userId: string) {
    return this._organizationRepository.getOrgsByUserId(userId);
  }

  updateApiKey(orgId: string) {
    return this._organizationRepository.updateApiKey(orgId);
  }

  // The next checkout comes without a free trial.
  endTrialOffer(orgId: string) {
    return this._organizationRepository.endTrialOffer(orgId);
  }

  getMailRecipients(orgId: string) {
    return this._organizationRepository.getAllUsersOrgs(orgId);
  }

  getTeam(orgId: string) {
    return this._organizationRepository.getTeam(orgId);
  }

  async setStreak(organizationId: string, type: 'start' | 'end') {
    return this._organizationRepository.setStreak(organizationId, type);
  }

  getLastPublishDate(organizationId: string) {
    return this._organizationRepository.getLastPublishDate(organizationId);
  }

  getOrgByCustomerId(customerId: string) {
    return this._organizationRepository.getOrgByCustomerId(customerId);
  }

  async inviteTeamMember(orgId: string, body: AddTeamMemberDto) {
    const timeLimit = dayjs().add(1, 'hour').format('YYYY-MM-DD HH:mm:ss');
    const id = makeId(5);
    const url =
      process.env.FRONTEND_URL +
      // `purpose` makes it an invitation and nothing else: acceptance read any
      // signed token as one.
      `/?org=${AuthService.signJWT({
        ...body,
        purpose: 'invite',
        orgId,
        timeLimit,
        id,
      })}`;
    if (body.sendEmail) {
      await this._notificationsService.sendEmail(
        body.email,
        'You have been invited to a team on Postra',
        `You have been invited to join a team on Postra.<br />Click <a href="${url}">here</a> to join.<br />This link expires in 1 hour.`
      );
    }
    return { url };
  }

  // Removing a member, changing a role and handing ownership over read the
  // current roles and write under the organisation's lock (repository): a
  // check made earlier let concurrent requests leave it without an owner.
  async deleteTeamMember(org: Organization, myId: string, userId: string) {
    const result = await this._organizationRepository.removeMember(org.id, myId, userId);
    // Narrowed by key: this repo builds without strictNullChecks.
    if (!('reason' in result)) return result;
    switch (result.reason) {
      case 'not-member':
        throw new NotFoundException('User is not part of this organization');
      case 'forbidden':
        throw new ForbiddenException('You do not have permission to delete this user');
      case 'last-owner':
        throw new BadRequestException(
          'The organisation needs an owner. Make someone else the owner first: Settings, Team, Make owner.'
        );
    }
  }

  // Roles were fixed at invitation: making a member an admin (or back) meant
  // removing and inviting them again, and the owner could never hand the
  // organisation over. Only the owner changes roles, never their own: they
  // hand ownership over instead.
  private async roleChange(
    org: Organization,
    myId: string,
    userId: string,
    role: 'USER' | 'ADMIN' | 'OWNER',
    action: string
  ) {
    const result = await this._organizationRepository.changeMemberRole(
      org.id,
      myId,
      userId,
      role
    );
    // Narrowed by key: this repo builds without strictNullChecks.
    if (!('reason' in result)) return result;
    switch (result.reason) {
      case 'not-owner':
        throw new ForbiddenException(`Only the owner can ${action}.`);
      case 'self':
        throw new BadRequestException('You cannot change your own role.');
      case 'not-member':
        throw new NotFoundException('User is not part of this organization');
      case 'already-owner':
        throw new BadRequestException('This member is already an owner.');
      case 'unavailable':
        throw new BadRequestException(
          'This member cannot become the owner while their seat is turned off or their account is suspended.'
        );
    }
  }

  async changeTeamMemberRole(
    org: Organization,
    myId: string,
    userId: string,
    role: 'USER' | 'ADMIN'
  ) {
    const { from } = await this.roleChange(org, myId, userId, role, 'change roles');
    return { from, to: role };
  }

  async transferOwnership(org: Organization, myId: string, userId: string) {
    const { from } = await this.roleChange(
      org,
      myId,
      userId,
      'OWNER',
      'hand over the organisation'
    );
    return { from };
  }

  async disableOrEnableNonSuperAdminUsers(orgId: string, disable: boolean) {
    // Capture who's affected BEFORE the toggle (disable flips them all; the
    // set is the same either way since SUPERADMINs are excluded), so we can
    // drop their cached auth-context right after.
    const affectedUserIds =
      await this._organizationRepository.getNonSuperAdminMemberIds(orgId);
    const result =
      await this._organizationRepository.disableOrEnableNonSuperAdminUsers(
        orgId,
        disable
      );
    // Subscription downgrade/cancel and admin bulk-disable both land here — bust
    // the members' 30s auth-context cache so the permission change is immediate.
    await bustAuthContextCacheForUsers(affectedUserIds);
    return result;
  }

  getActiveMemberCount(orgId: string) {
    return this._organizationRepository.getActiveMemberCount(orgId);
  }

  // Bring the org's active team members in line with a tier's seat allowance.
  // The owner (SUPERADMIN) is always kept; among the rest the earliest-joined
  // fill the remaining seats and anyone over the cap is disabled. Runs on every
  // tier change: a downgrade disables the overflow, an upgrade re-enables people
  // back within the new cap. `seatLimit` counts the owner, so Starter=1 keeps
  // the owner only.
  async reconcileTeamSeats(orgId: string, seatLimit: number) {
    const members =
      await this._organizationRepository.getMembersForSeatReconcile(orgId);
    const ordered = [...members].sort((a, b) => {
      const aOwner = a.role === Role.SUPERADMIN ? 0 : 1;
      const bOwner = b.role === Role.SUPERADMIN ? 0 : 1;
      if (aOwner !== bOwner) return aOwner - bOwner;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keep = new Set(ordered.slice(0, seatLimit).map((m) => m.userId));
    const toEnable = ordered
      .filter(
        (m) => keep.has(m.userId) && m.disabled && m.role !== Role.SUPERADMIN
      )
      .map((m) => m.userId);
    const toDisable = ordered
      .filter(
        (m) => !keep.has(m.userId) && !m.disabled && m.role !== Role.SUPERADMIN
      )
      .map((m) => m.userId);
    if (toEnable.length) {
      await this._organizationRepository.setMembersDisabled(
        orgId,
        toEnable,
        false
      );
    }
    if (toDisable.length) {
      await this._organizationRepository.setMembersDisabled(
        orgId,
        toDisable,
        true
      );
    }
    // Bust the 30s auth-context cache for anyone whose access just changed.
    await bustAuthContextCacheForUsers([...toEnable, ...toDisable]);
  }

  getShortlinkPreference(orgId: string) {
    return this._organizationRepository.getShortlinkPreference(orgId);
  }

  updateShortlinkPreference(orgId: string, shortlink: ShortLinkPreference) {
    return this._organizationRepository.updateShortlinkPreference(
      orgId,
      shortlink
    );
  }
}
