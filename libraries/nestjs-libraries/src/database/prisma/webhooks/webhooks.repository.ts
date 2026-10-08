import {
  PrismaRepository,
  PrismaTransaction,
} from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { BadRequestException, Injectable } from '@nestjs/common';
import { WebhooksDto } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { newWebhookSecret } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.signature';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

@Injectable()
export class WebhooksRepository {
  constructor(
    private _webhooks: PrismaRepository<'webhooks'>,
    private _integration: PrismaRepository<'integration'>,
    private _transaction: PrismaTransaction
  ) {}

  getTotal(orgId: string) {
    return this._webhooks.model.webhooks.count({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
    });
  }

  // Every member's settings page reads this: the signing secret stays out
  // (admins read it on its own route).
  getWebhooks(orgId: string, withSecret = false) {
    return this._webhooks.model.webhooks.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
      },
      omit: { secret: !withSecret },
      include: {
        integrations: {
          select: {
            integration: {
              select: {
                id: true,
                picture: true,
                name: true,
              },
            },
          },
        },
      },
    });
  }

  // The webhook's signing secret, decrypted; made now for a webhook created
  // before secrets existed. Null for a webhook this org does not have.
  async getSecret(orgId: string, id: string): Promise<string | null> {
    const where = { id, organizationId: orgId, deletedAt: null as null };
    const row = await this._webhooks.model.webhooks.findFirst({
      where,
      select: { secret: true },
    });
    if (!row) {
      return null;
    }
    if (!row.secret) {
      // Only where it is still empty, so two first deliveries at once agree
      // on one secret.
      await this._webhooks.model.webhooks.updateMany({
        where: { ...where, secret: null },
        data: { secret: AuthService.encryptIntegrationToken(newWebhookSecret()) },
      });
      return this.getSecret(orgId, id);
    }
    return AuthService.decryptIntegrationToken(row.secret);
  }

  async rotateSecret(orgId: string, id: string) {
    const { count } = await this._webhooks.model.webhooks.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { secret: AuthService.encryptIntegrationToken(newWebhookSecret()) },
    });
    return count ? this.getSecret(orgId, id) : null;
  }

  // updateMany, not update: update throws on a missing row (an unknown id or
  // another org's webhook answered 500) and re-deleted a deleted one. Null
  // when nothing of this org matched.
  async deleteWebhook(orgId: string, id: string) {
    const { count } = await this._webhooks.model.webhooks.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    return count ? { id } : null;
  }

  // Null on an update of a webhook this org does not have (or deleted).
  async createWebhook(orgId: string, body: WebhooksDto) {
    // Only channels the org owns. An unknown or foreign id used to be dropped
    // in silence, and an empty list means "every channel": a webhook meant
    // for one channel received all of them (POSTS-5).
    const requested = [...new Set((body.integrations || []).map((i) => i.id))];
    const owned = requested.length
      ? await this._integration.model.integration.findMany({
          where: { organizationId: orgId, id: { in: requested } },
          select: { id: true },
        })
      : [];
    if (owned.length !== requested.length) {
      throw new BadRequestException(
        'Some of the selected channels are not in this organisation'
      );
    }
    const links = owned.map((integration) => ({
      integrationId: integration.id,
    }));

    // The webhook and its channel filter in one write: a new webhook used to
    // exist without its filter for a moment, which reads as "all channels"
    // to a publish happening right then (POSTS-4).
    return this._transaction.model.$transaction(async (tx) => {
      if (!body.id) {
        const created = await tx.webhooks.create({
          data: {
            organizationId: orgId,
            url: body.url,
            name: body.name,
            secret: AuthService.encryptIntegrationToken(newWebhookSecret()),
            integrations: { create: links },
          },
        });
        return { id: created.id };
      }

      // Update path (PUT /webhooks): scope to the org and NEVER create.
      // A prior upsert here let a made-up id fall through to `create`,
      // turning the (un-policy-checked) update route into an uncapped
      // create that bypassed the per-plan webhook limit enforced on POST.
      const updated = await tx.webhooks.updateMany({
        where: { id: body.id, organizationId: orgId, deletedAt: null },
        data: { url: body.url, name: body.name },
      });
      if (updated.count === 0) {
        return null;
      }
      await tx.webhooks.update({
        where: { id: body.id, organizationId: orgId },
        data: { integrations: { deleteMany: {}, create: links } },
      });
      return { id: body.id };
    });
  }
}
