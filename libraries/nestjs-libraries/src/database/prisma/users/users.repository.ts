import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Provider } from '@prisma/client';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { EmailNotificationsDto } from '@gitroom/nestjs-libraries/dtos/users/email-notifications.dto';

@Injectable()
export class UsersRepository {
  constructor(
    private _user: PrismaRepository<'user'>,
    private _media: PrismaRepository<'media'>
  ) {}

  /**
   * Mark a user as seen. Fire-and-forget and already throttled by the caller:
   * a failure here must never touch the request it rode in on.
   */
  touchLastOnline(id: string) {
    return this._user.model.user
      .update({
        where: { id },
        data: { lastOnline: new Date() },
      })
      .catch(() => undefined);
  }

  getImpersonateUser(name: string) {
    return this._user.model.user.findMany({
      where: {
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
      select: {
        id: true,
        name: true,
        email: true,
      },
      take: 10,
    });
  }

  getUserById(id: string) {
    return this._user.model.user.findFirst({
      where: {
        id,
      },
    });
  }

  getUserByEmail(email: string) {
    return this._user.model.user.findFirst({
      where: {
        email,
        providerName: Provider.LOCAL,
      },
      include: {
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });
  }

  getUserByNormalizedEmail(normalizedEmail: string) {
    return this._user.model.user.findFirst({
      where: {
        emailNormalized: normalizedEmail,
        providerName: Provider.LOCAL,
      },
    });
  }

  activateUser(id: string) {
    return this._user.model.user.update({
      where: {
        id,
      },
      data: {
        activated: true,
      },
    });
  }

  getUserByProvider(providerId: string, provider: Provider) {
    return this._user.model.user.findFirst({
      where: {
        providerId,
        providerName: provider,
      },
    });
  }

  updatePassword(id: string, password: string) {
    return this._user.model.user.update({
      where: {
        id,
        providerName: Provider.LOCAL,
      },
      data: {
        password: AuthService.hashPassword(password),
        // Revoke every session issued before this reset (ASVS 3.3.1). The
        // caller must also bust the authctx cache so the bump is seen within
        // the 30s cache TTL.
        tokenVersion: { increment: 1 },
      },
    });
  }

  changeAudienceSize(userId: string, audience: number) {
    return this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        audience,
      },
    });
  }

  async getPersonal(userId: string) {
    const user = await this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        name: true,
        bio: true,
        picture: {
          select: {
            id: true,
            path: true,
          },
        },
      },
    });

    return user;
  }

  async changePersonal(userId: string, orgId: string, body: UserDetailDto) {
    // Media is connected by id only, so without this check a user could point
    // their avatar at another org's media row (IDOR). Confirm ownership first.
    if (body.picture?.id) {
      const owned = await this._media.model.media.findFirst({
        where: { id: body.picture.id, organizationId: orgId },
        select: { id: true },
      });
      if (!owned) {
        throw new ForbiddenException('Picture not found');
      }
    }

    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        name: body.fullname,
        bio: body.bio,
        picture: body.picture
          ? {
              connect: {
                id: body.picture.id,
              },
            }
          : {
              disconnect: true,
            },
      },
    });
  }

  async getEmailNotifications(userId: string) {
    return this._user.model.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        sendSuccessEmails: true,
        sendFailureEmails: true,
      },
    });
  }

  async updateEmailNotifications(userId: string, body: EmailNotificationsDto) {
    await this._user.model.user.update({
      where: {
        id: userId,
      },
      data: {
        sendSuccessEmails: body.sendSuccessEmails,
        sendFailureEmails: body.sendFailureEmails,
      },
    });
  }
}
