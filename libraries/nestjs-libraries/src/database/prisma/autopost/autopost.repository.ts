import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';

@Injectable()
export class AutopostRepository {
  constructor(private _autoPost: PrismaRepository<'autoPost'>) {}

  getTotal(orgId: string) {
    return this._autoPost.model.autoPost.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  getAutoposts(orgId: string) {
    return this._autoPost.model.autoPost.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  deleteAutopost(orgId: string, id: string) {
    return this._autoPost.model.autoPost.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  getAutopost(id: string) {
    return this._autoPost.model.autoPost.findUnique({
      where: {
        id,
        deletedAt: null,
      },
    });
  }

  updateUrl(id: string, url: string) {
    return this._autoPost.model.autoPost.update({
      where: {
        id,
      },
      data: {
        lastUrl: url,
      },
    });
  }

  changeActive(orgId: string, id: string, active: boolean) {
    return this._autoPost.model.autoPost.update({
      where: {
        id,
        organizationId: orgId,
      },
      data: {
        active,
      },
    });
  }

  async createAutopost(orgId: string, body: AutopostDto, id?: string) {
    const data = {
      url: body.url,
      title: body.title,
      integrations: JSON.stringify(body.integrations),
      active: body.active,
      content: body.content,
      generateContent: body.generateContent,
      addPicture: body.addPicture,
      syncLast: body.syncLast,
      onSlot: body.onSlot,
      lastUrl: body.lastUrl,
      tone: body.tone,
      customInstructions: body.customInstructions,
    };

    // Update path: only ever touch a feed that already exists for this org.
    // The old upsert would mint a brand-new feed for any unknown id, so
    // `PUT /autopost/<random-uuid>` bypassed the per-plan autoPostLimit (the
    // Update policy skips the cap check by design). A plain org-scoped update
    // throws P2025 on an unknown/foreign id instead of creating.
    if (id) {
      const { id: updatedId, active } = await this._autoPost.model.autoPost.update({
        where: {
          id,
          organizationId: orgId,
        },
        data,
      });
      return { id: updatedId, active };
    }

    // lastUrl is optional in the DTO but a required column: the UI always
    // sends it, so a plain API call without it was a 500 instead of a feed.
    const { id: newId, active } = await this._autoPost.model.autoPost.create({
      data: {
        organizationId: orgId,
        ...data,
        lastUrl: data.lastUrl ?? '',
      },
    });

    return { id: newId, active };
  }
}
