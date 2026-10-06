import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsRepository {
  constructor(
    private _notifications: PrismaRepository<'notifications'>,
    private _user: PrismaRepository<'user'>,
    private _userOrg: PrismaRepository<'userOrganization'>
  ) {}

  // When this user last opened the bell in this organisation (E2E-02-38).
  async getLastReadNotification(userId: string, organizationId: string) {
    const membership = await this._userOrg.model.userOrganization.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: { lastReadNotifications: true },
    });
    if (membership?.lastReadNotifications) {
      return { lastReadNotifications: membership.lastReadNotifications };
    }
    const user = await this._user.model.user.findFirst({
      where: { id: userId },
      select: { lastReadNotifications: true },
    });
    return { lastReadNotifications: user?.lastReadNotifications ?? new Date(0) };
  }

  async getMainPageCount(organizationId: string, userId: string) {
    const { lastReadNotifications } = await this.getLastReadNotification(
      userId,
      organizationId
    );

    return {
      total: await this._notifications.model.notifications.count({
        where: {
          organizationId,
          createdAt: {
            gt: lastReadNotifications,
          },
        },
      }),
    };
  }

  async createNotification(organizationId: string, content: string) {
    await this._notifications.model.notifications.create({
      data: {
        organizationId,
        content,
      },
    });
  }

  async getNotificationsSince(organizationId: string, since: string) {
    return this._notifications.model.notifications.findMany({
      where: {
        organizationId,
        deletedAt: null,
        createdAt: {
          gte: new Date(since),
        },
      },
    });
  }

  async getNotificationsPaginated(organizationId: string, page: number) {
    const limit = 100;
    const skip = page * limit;

    const where = {
      organizationId,
      deletedAt: null as Date | null,
    };

    const [notifications, total] = await Promise.all([
      this._notifications.model.notifications.findMany({
        where,
        orderBy: {
          createdAt: 'desc',
        },
        skip,
        take: limit,
        select: {
          id: true,
          content: true,
          link: true,
          createdAt: true,
        },
      }),
      this._notifications.model.notifications.count({ where }),
    ]);

    return {
      notifications,
      total,
      page,
      limit,
      hasMore: skip + notifications.length < total,
    };
  }

  async getNotifications(organizationId: string, userId: string) {
    const { lastReadNotifications } = await this.getLastReadNotification(
      userId,
      organizationId
    );

    await this._userOrg.model.userOrganization.updateMany({
      where: { userId, organizationId },
      data: { lastReadNotifications: new Date() },
    });

    return {
      lastReadNotifications,
      notifications: await this._notifications.model.notifications.findMany({
        orderBy: {
          createdAt: 'desc',
        },
        take: 10,
        where: {
          organizationId,
          deletedAt: null,
        },
        select: {
          createdAt: true,
          content: true,
        },
      }),
    };
  }
}
