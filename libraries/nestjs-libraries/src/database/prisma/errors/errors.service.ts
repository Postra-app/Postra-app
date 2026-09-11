import { Injectable } from '@nestjs/common';
import { ErrorsRepository } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.repository';

@Injectable()
export class ErrorsService {
  constructor(private _errorsRepository: ErrorsRepository) {}

  listErrors(params: {
    page?: number;
    limit?: number;
    platform?: string;
    email?: string;
    unknownFirst?: boolean;
    days?: number;
  }) {
    return this._errorsRepository.listErrors(params);
  }

  getError(id: string) {
    return this._errorsRepository.getError(id);
  }

  listPlatforms() {
    return this._errorsRepository.listPlatforms();
  }

  scrubSecrets(apply: boolean) {
    return this._errorsRepository.scrubSecrets(apply);
  }
}
