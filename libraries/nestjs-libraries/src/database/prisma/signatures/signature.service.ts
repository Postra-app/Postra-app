import { Injectable, NotFoundException } from '@nestjs/common';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureDto } from '@gitroom/nestjs-libraries/dtos/signature/signature.dto';

@Injectable()
export class SignatureService {
  constructor(private _signatureRepository: SignatureRepository) {}

  getSignaturesByOrgId(orgId: string) {
    return this._signatureRepository.getSignaturesByOrgId(orgId);
  }

  getDefaultSignature(orgId: string) {
    return this._signatureRepository.getDefaultSignature(orgId);
  }

  async createOrUpdateSignature(
    orgId: string,
    signature: SignatureDto,
    id?: string
  ) {
    const saved = await this._signatureRepository.createOrUpdateSignature(
      orgId,
      signature,
      id
    );
    if (!saved) {
      throw new NotFoundException('Signature not found');
    }
    return saved;
  }

  async deleteSignature(orgId: string, id: string) {
    const deleted = await this._signatureRepository.deleteSignature(orgId, id);
    if (!deleted) {
      throw new NotFoundException('Signature not found');
    }
    return deleted;
  }
}
