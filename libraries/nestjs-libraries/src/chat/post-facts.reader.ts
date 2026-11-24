import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

const select = {
  publishDate: true,
  content: true,
  // A draft that is moved stays a draft; the tools say so.
  state: true,
  integration: { select: { name: true, providerIdentifier: true } },
} as const;

/**
 * Reads what the Approve card needs about a post: channel, date, opening
 * words. Read-only on purpose: the delete and reschedule tools hold this and
 * nothing that can change a post, so they can only park an action.
 */
@Injectable()
export class PostFactsReader {
  constructor(private _post: PrismaRepository<'post'>) {}

  byGroup(organizationId: string, group: string) {
    return this._post.model.post.findMany({
      where: { organizationId, group, deletedAt: null, parentPostId: null },
      select,
    });
  }

  byId(id: string, organizationId: string) {
    return this._post.model.post.findFirst({
      where: { id, organizationId, deletedAt: null },
      select,
    });
  }
}
