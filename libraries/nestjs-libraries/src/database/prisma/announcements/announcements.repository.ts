import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AnnouncementDto } from '@gitroom/nestjs-libraries/dtos/announcements/announcements.dto';
import { AnnouncementColor } from '@prisma/client';

@Injectable()
export class AnnouncementsRepository {
  constructor(private _announcements: PrismaRepository<'announcement'>) {}

  getAnnouncements() {
    return this._announcements.model.announcement.findMany({
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  createAnnouncement(body: AnnouncementDto) {
    return this._announcements.model.announcement.create({
      data: {
        title: body.title,
        description: body.description,
        color: (body.color as AnnouncementColor) || AnnouncementColor.INFO,
      },
    });
  }

  /**
   * deleteMany, not delete: Prisma throws on a row that is not there, and the
   * controller turned that into a 500 for what is really "already gone"
   * (E2E-09-46). Returns whether anything was removed, so the caller can say
   * so.
   */
  async deleteAnnouncement(id: string) {
    const { count } = await this._announcements.model.announcement.deleteMany({
      where: { id },
    });
    return { deleted: count > 0 };
  }
}
