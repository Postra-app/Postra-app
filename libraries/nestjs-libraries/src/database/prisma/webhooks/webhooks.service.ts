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

  // `paused`: over the plan's limit, so not delivered to (the newest ones).
  async getWebhooks(orgId: string) {
    const limit = await this._webhooksRepository.getDeliveryLimit(orgId);
    return (await this._webhooksRepository.getWebhooks(orgId)).map(
      (webhook, index) => ({ ...webhook, paused: index >= limit })
    );
  }

  // For delivery: the webhooks the plan covers (oldest first), each with its
  // signing secret, decrypted (made now for a webhook that has none yet).
  async getWebhooksForDelivery(orgId: string) {
    const limit = await this._webhooksRepository.getDeliveryLimit(orgId);
    return Promise.all(
      (await this._webhooksRepository.getWebhooks(orgId, true))
        .slice(0, limit)
        .map(
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
