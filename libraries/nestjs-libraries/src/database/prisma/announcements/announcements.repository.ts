import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AnnouncementDto } from '@gitroom/nestjs-libraries/dtos/announcements/announcements.dto';
import { AnnouncementColor, Prisma } from '@prisma/client';

// The banner is fetched by every signed-in session, so this query runs far
// more often than any other in the panel's orbit. Cap it: more than a handful
// of live announcements is a mistake, not a use case.
const ACTIVE_LIMIT = 5;

@Injectable()
export class AnnouncementsRepository {
  constructor(private _announcements: PrismaRepository<'announcement'>) {}

  /**
   * What the banner shows: not deleted, and either open-ended or not yet
   * expired.
   *
   * This used to be every row in the table, ordered by date — an announcement
   * stopped only when an operator remembered to delete it, and the endpoint
   * handed the whole history to every session (E2E-09-26).
   */
  getAnnouncements() {
    return this._announcements.model.announcement.findMany({
      where: {
        deletedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      orderBy: { createdAt: 'desc' },
      take: ACTIVE_LIMIT,
    });
  }

  /**
   * The panel's own list: paged, and it keeps expired entries visible so the
   * operator can see what has already stopped showing.
   */
  async listAnnouncements({ skip, limit }: { skip: number; limit: number }) {
    const where: Prisma.AnnouncementWhereInput = { deletedAt: null };
    const [items, total] = await Promise.all([
      this._announcements.model.announcement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this._announcements.model.announcement.count({ where }),
    ]);

    return { items, total };
  }

  createAnnouncement(body: AnnouncementDto) {
    return this._announcements.model.announcement.create({
      data: {
        title: body.title,
        description: body.description,
        color: (body.color as AnnouncementColor) || AnnouncementColor.INFO,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      },
    });
  }

  /**
   * Soft delete.
   *
   * `updateMany` rather than `update`, for the same reason the previous
   * version used `deleteMany`: Prisma throws on a row that is not there and
   * the controller turned that into a 500 for what is really "already gone"
   * (E2E-09-46). Narrowing on `deletedAt: null` keeps that answer honest when
   * the row exists but has already been removed — the count is 0 either way.
   *
   * The row stays so the audit entry naming who removed it still points at
   * something (E2E-09-26).
   */
  async deleteAnnouncement(id: string) {
    const { count } = await this._announcements.model.announcement.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return { deleted: count > 0 };
  }
}
