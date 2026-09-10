import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { StudioSpec } from '@gitroom/nestjs-libraries/studio/studio-spec';
import { PostDesignSpec } from '@gitroom/nestjs-libraries/studio/post-design-spec';

@Injectable()
export class MediaRepository {
  constructor(private _media: PrismaRepository<'media'>) {}

  saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    // True when the bytes came from an image model. Recorded at creation
    // because nothing downstream can tell afterwards — our renderers strip the
    // C2PA marker the model embeds.
    aiGenerated = false
  ) {
    return this._media.model.media.create({
      data: {
        organization: {
          connect: {
            id: org,
          },
        },
        name: fileName,
        path: filePath,
        originalName: originalName || null,
        aiGenerated,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        aiGenerated: true,
      },
    });
  }

  getMediaById(id: string) {
    return this._media.model.media.findUnique({
      where: {
        id,
      },
    });
  }

  getMediaByIdForOrg(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: { id, organizationId: org },
      select: { id: true, path: true, canvasJson: true, designSpec: true },
    });
  }

  // Full row, org-scoped — for post-media resolution where the caller must
  // never reach another org's asset by id.
  getMediaByIdOrg(org: string, id: string) {
    return this._media.model.media.findFirst({
      where: { id, organizationId: org },
    });
  }

  saveDesignSpec(org: string, id: string, spec: StudioSpec) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { designSpec: spec as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
  }

  // The flat generation shape (headline/subtext/cta over a background). Stored
  // so Studio can rebuild an editable canvas from it (a branded draft the agent
  // produced server-side). Shares the `designSpec` column with `StudioSpec`;
  // the two are told apart on read by shape (`layout`/`headline` vs `layers`).
  savePostDesignSpec(org: string, id: string, spec: PostDesignSpec) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { designSpec: spec as unknown as Prisma.InputJsonValue },
      select: { id: true },
    });
  }

  saveCanvasJson(org: string, id: string, canvasJson: string) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { canvasJson },
      select: { id: true },
    });
  }

  setTemplateFlag(org: string, id: string, isTemplate: boolean) {
    return this._media.model.media.update({
      where: { id, organizationId: org },
      data: { isTemplate },
      select: { id: true, isTemplate: true },
    });
  }

  getTemplates(org: string) {
    return this._media.model.media.findMany({
      where: {
        organizationId: org,
        isTemplate: true,
        deletedAt: null,
        canvasJson: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, path: true, createdAt: true },
      take: 200,
    });
  }

  deleteMedia(org: string, id: string) {
    return this._media.model.media.update({
      where: {
        id,
        organizationId: org,
      },
      data: {
        deletedAt: new Date(),
      },
    });
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._media.model.media.update({
      where: {
        id: data.id,
        organizationId: org,
      },
      data: {
        alt: data.alt,
        thumbnail: data.thumbnail,
        thumbnailTimestamp: data.thumbnailTimestamp,
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        alt: true,
        thumbnail: true,
        path: true,
        thumbnailTimestamp: true,
      },
    });
  }

  async getMedia(org: string, page: number, search?: string) {
    const pageNum = (page || 1) - 1;
    const trimmedSearch = search?.trim();
    const searchFilter = trimmedSearch
      ? {
          originalName: {
            contains: trimmedSearch,
            mode: 'insensitive' as const,
          },
        }
      : {};
    const query = {
      where: {
        organization: {
          id: org,
        },
        deletedAt: null as null,
        ...searchFilter,
      },
    };
    const pages = Math.ceil((await this._media.model.media.count(query)) / 18);
    const results = await this._media.model.media.findMany({
      where: {
        organizationId: org,
        deletedAt: null as null,
        ...searchFilter,
      },
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
        aiGenerated: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }
}
