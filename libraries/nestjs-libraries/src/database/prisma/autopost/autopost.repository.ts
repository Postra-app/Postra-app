import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';

// An org-scoped update of an id that is not this org's feed throws P2025,
// which reached the client as a 500 (AI-13). It is a 404.
const feedNotFound = (err: any): never => {
  if (err?.code === 'P2025') {
    throw new NotFoundException('Auto Post feed not found');
  }
  throw err;
};

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
    return this._autoPost.model.autoPost
      .update({
        where: {
          id,
          organizationId: orgId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      })
      .catch(feedNotFound);
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
    return this._autoPost.model.autoPost
      .update({
        where: {
          id,
          organizationId: orgId,
          deletedAt: null,
        },
        data: {
          active,
        },
      })
      .catch(feedNotFound);
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
      const { id: updatedId, active } = await this._autoPost.model.autoPost
        .update({
          where: {
            id,
            organizationId: orgId,
            deletedAt: null,
          },
          data,
        })
        .catch(feedNotFound);
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
