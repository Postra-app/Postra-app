import { Injectable, NotFoundException } from '@nestjs/common';
import { WebhooksRepository } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.repository';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class WebhooksService {
  constructor(private _webhooksRepository: WebhooksRepository) {}

  getTotal(orgId: string) {
    return this._webhooksRepository.getTotal(orgId);
  }

  getWebhooks(orgId: string) {
    return this._webhooksRepository.getWebhooks(orgId);
  }

  // For delivery: each webhook with its signing secret, decrypted (made now
  // for a webhook that has none yet).
  async getWebhooksForDelivery(orgId: string) {
    return Promise.all(
      (await this._webhooksRepository.getWebhooks(orgId, true)).map(
        async ({ secret, ...webhook }) => ({
          ...webhook,
          secret: secret
            ? (AuthService.decryptIntegrationToken(secret) as string)
            : ((await this._webhooksRepository.getSecret(
                orgId,
                webhook.id
              )) as string),
        })
      )
    );
  }

  async getSecret(orgId: string, id: string) {
    const secret = await this._webhooksRepository.getSecret(orgId, id);
    if (!secret) {
      throw new NotFoundException('Webhook not found');
    }
    return { secret };
  }

  async rotateSecret(orgId: string, id: string) {
    const secret = await this._webhooksRepository.rotateSecret(orgId, id);
    if (!secret) {
      throw new NotFoundException('Webhook not found');
    }
    return { secret };
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
