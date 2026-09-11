import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
} from '@nestjs/common';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { User } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { AnnouncementsService } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.service';
import { AnnouncementDto } from '@gitroom/nestjs-libraries/dtos/announcements/announcements.dto';
import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';

@ApiTags('Announcements')
@Controller('/announcements')
export class AnnouncementsController {
  constructor(
    private _announcementsService: AnnouncementsService,
    private _auditService: AuditService
  ) {}

  @Get('/')
  async getAnnouncements() {
    return this._announcementsService.getAnnouncements();
  }

  @Post('/')
  async createAnnouncement(
    @GetUserFromRequest() user: User,
    @Body() body: AnnouncementDto
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    // Announcements are the panel's other mutating surface and the only one
    // that was not audited — an entry everybody sees, appearing with nothing
    // recording who put it there (E2E-09-26, E2E-09-34).
    const created = await this._announcementsService.createAnnouncement(body);
    this._auditService.record({
      action: 'admin.announcement.create',
      userId: user.id,
      metadata: { announcementId: created.id, title: created.title },
    });

    return created;
  }

  @Delete('/:id')
  async deleteAnnouncement(
    @GetUserFromRequest() user: User,
    @Param('id') id: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Unauthorized', 400);
    }

    const result = await this._announcementsService.deleteAnnouncement(id);
    if (result.deleted) {
      this._auditService.record({
        action: 'admin.announcement.delete',
        userId: user.id,
        metadata: { announcementId: id },
      });
    }

    return result;
  }
}
