import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';

@Injectable()
export class WebhooksService {
  constructor(private _webhooksRepository: WebhooksRepository) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  async createWebhook(orgId: string, body: WebhooksDto) {
    const saved = await this._webhooksRepository.createWebhook(orgId, body);
    if (!saved) {
      throw new NotFoundException('Webhook not found');
    }
    return saved;
  }

  async deleteWebhook(orgId: string, id: string) {
    const deleted = await this._webhooksRepository.deleteWebhook(orgId, id);
    if (!deleted) {
      throw new NotFoundException('Webhook not found');
    }
    return deleted;
  }
}
