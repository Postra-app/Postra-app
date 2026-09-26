import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SetsDto } from '@gitroom/nestjs-libraries/dtos/sets/sets.dto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class SetsRepository {
  constructor(private _sets: PrismaRepository<'sets'>) {}

  getTotal(orgId: string) {
    return this._sets.model.sets.count({
      where: {
        organizationId: orgId,
      },
    });
  }

  getSets(orgId: string) {
    return this._sets.model.sets.findMany({
      where: {
        organizationId: orgId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  // Both return null when the id isn't a set of this org. They used to hit
  // Prisma directly: a delete of another org's (or a gone) set threw P2025, and
  // an upsert keyed on a client-supplied id collided with another org's
  // primary key — 500s either way (E2E-05-18).
  async deleteSet(orgId: string, id: string) {
    const { count } = await this._sets.model.sets.deleteMany({
      where: { id, organizationId: orgId },
    });
    return count ? { id } : null;
  }

  async createSet(orgId: string, body: SetsDto) {
    if (body.id) {
      const { count } = await this._sets.model.sets.updateMany({
        where: { id: body.id, organizationId: orgId },
        data: { name: body.name, content: body.content },
      });
      return count ? { id: body.id } : null;
    }

    const { id } = await this._sets.model.sets.create({
      data: {
        id: uuidv4(),
        organizationId: orgId,
        name: body.name,
        content: body.content,
      },
    });
    return { id };
  }
} 