import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { Injectable } from '@nestjs/common';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

@Injectable()
export class SignatureRepository {
  constructor(private _signatures: PrismaRepository<'signatures'>) {}

  getSignaturesByOrgId(orgId: string) {
    return this._signatures.model.signatures.findMany({
      where: { organizationId: orgId, deletedAt: null },
    });
  }

  getDefaultSignature(orgId: string) {
    return this._signatures.model.signatures.findFirst({
      where: { organizationId: orgId, autoAdd: true, deletedAt: null },
    });
  }

  // Both return null when the id isn't a live signature of this org. The
  // upsert used to create a brand-new signature when handed a foreign or
  // deleted id (and make it the default), and the delete threw P2025 — a 500
  // (E2E-05-18).
  async createOrUpdateSignature(
    orgId: string,
    signature: SignatureDto,
    id?: string
  ) {
    const values = {
      content: signature.content,
      autoAdd: signature.autoAdd,
    };

    let updatedId: string;
    if (id) {
      const { count } = await this._signatures.model.signatures.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: values,
      });
      if (!count) {
        return null;
      }
      updatedId = id;
    } else {
      ({ id: updatedId } = await this._signatures.model.signatures.create({
        data: { ...values, organizationId: orgId },
      }));
    }

    if (values.autoAdd) {
      await this._signatures.model.signatures.updateMany({
        where: { organizationId: orgId, id: { not: updatedId } },
        data: { autoAdd: false },
      });
    }

    return { id: updatedId };
  }

  async deleteSignature(orgId: string, id: string) {
    const { count } = await this._signatures.model.signatures.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count ? { id } : null;
  }
}
