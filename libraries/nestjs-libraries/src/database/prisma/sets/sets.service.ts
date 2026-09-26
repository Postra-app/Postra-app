import { Injectable, NotFoundException } from '@nestjs/common';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { SetsDto } from '@gitroom/nestjs-libraries/dtos/sets/sets.dto';

@Injectable()
export class SetsService {
  constructor(private _setsRepository: SetsRepository) {}

  getTotal(orgId: string) {
    return this._setsRepository.getTotal(orgId);
  }

  getSets(orgId: string) {
    return this._setsRepository.getSets(orgId);
  }

  async createSet(orgId: string, body: SetsDto) {
    const set = await this._setsRepository.createSet(orgId, body);
    if (!set) {
      throw new NotFoundException('Set not found');
    }
    return set;
  }

  async deleteSet(orgId: string, id: string) {
    const set = await this._setsRepository.deleteSet(orgId, id);
    if (!set) {
      throw new NotFoundException('Set not found');
    }
    return set;
  }
} 