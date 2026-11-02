import { Throttle } from '@nestjs/throttler';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { ChangeTeamRoleDto } from '@gitroom/nestjs-libraries/dtos/settings/change.team.role.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { AddTeamMemberDto } from '@gitroom/nestjs-libraries/dtos/settings/add.team.member.dto';
import { ShortlinkPreferenceDto } from '@gitroom/nestjs-libraries/dtos/settings/shortlink-preference.dto';
import { ApiTags } from '@nestjs/swagger';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { bustAuthContextCache } from '@gitroom/backend/services/auth/auth.middleware';

@ApiTags('Settings')
@Controller('/settings')
export class SettingsController {
  constructor(
    private _organizationService: OrganizationService,
    private _auditService: AuditService
  ) {}

  // Only inviting takes a seat, so only inviting checks for a free one. With
  // the seat check on all three routes, a full team (Pro: owner + 1, or any
  // team after a downgrade) could neither see its members nor remove one to
  // make room.
  @Get('/team')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async getTeam(@GetOrgFromRequest() org: Organization) {
    return this._organizationService.getTeam(org.id);
  }

  // Role before seats: the guard answers for the first failing policy, and a
  // plain member must hear "not allowed" (403), not "upgrade your plan" (402).
  @Post('/team')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.ADMIN],
    [AuthorizationActions.Create, Sections.TEAM_MEMBERS]
  )
  @Throttle({ default: { ttl: 3_600_000, limit: 20 } })
  async inviteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AddTeamMemberDto
  ) {
    return this._organizationService.inviteTeamMember(org.id, body);
  }

  @Delete('/team/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteTeamMember(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    const result = await this._organizationService.deleteTeamMember(org, id);
    // The removed member's org list lives in the 30s auth-context cache — drop
    // it so they lose access to this org immediately, not up to 30s later.
    await bustAuthContextCache(id);
    this._auditService.record({
      action: 'team.member.remove',
      organizationId: org.id,
      metadata: { targetUserId: id },
    });
    return result;
  }

  // The owner makes a member an admin or back. Roles live in the 30s
  // auth-context cache, so the member's is dropped: the change applies at
  // once, not half a minute later.
  @Put('/team/:id/role')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async changeTeamMemberRole(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: ChangeTeamRoleDto
  ) {
    const change = await this._organizationService.changeTeamMemberRole(
      org,
      user.id,
      id,
      body.role
    );
    await bustAuthContextCache(id);
    if (change.from !== change.to) {
      this._auditService.record({
        action: 'team.role.change',
        organizationId: org.id,
        metadata: { targetUserId: id, ...change },
      });
    }
    return { role: change.to };
  }

  // The owner hands the organisation to a member and stays on as an admin.
  // Not while impersonating (auth.middleware.ts): support must not give a
  // customer's organisation away under their name.
  @Post('/transfer-ownership/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async transferOwnership(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    const change = await this._organizationService.transferOwnership(
      org,
      user.id,
      id
    );
    await bustAuthContextCache(id);
    await bustAuthContextCache(user.id);
    this._auditService.record({
      action: 'team.owner.transfer',
      organizationId: org.id,
      metadata: { targetUserId: id, targetRoleBefore: change.from },
    });
    return { ok: true };
  }

  @Get('/shortlink')
  async getShortlinkPreference(@GetOrgFromRequest() org: Organization) {
    // `available`: with no shortener configured (no Dub/Short.io/Kutt/LinkDrip
    // keys — production today) the preference changes nothing, so the settings
    // page should not offer "Always shortlink".
    return {
      ...(await this._organizationService.getShortlinkPreference(org.id)),
      available: ShortLinkService.provider.shortLinkDomain !== 'empty',
    };
  }

  @Post('/shortlink')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async updateShortlinkPreference(
    @GetOrgFromRequest() org: Organization,
    @Body() body: ShortlinkPreferenceDto
  ) {
    return this._organizationService.updateShortlinkPreference(
      org.id,
      body.shortlink
    );
  }
}
