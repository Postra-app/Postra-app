import { Throttle } from '@nestjs/throttler';
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '@gitroom/nestjs-libraries/database/prisma/webhooks/webhooks.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  OnlyURL, UpdateDto, WebhooksDto
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';
import { AuthorizationActions, Sections } from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import {
  signWebhookBody,
  WEBHOOK_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
} from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.signature';

@ApiTags('Webhooks')
@Controller('/webhooks')
export class WebhookController {
  constructor(private _webhooksService: WebhooksService) {}

  @Get('/')
  async getStatistics(@GetOrgFromRequest() org: Organization) {
    return this._webhooksService.getWebhooks(org.id);
  }

  // Webhooks send organisation data to outside URLs: admins only. ADMIN goes
  // first so a member hears 403, not "upgrade your plan".
  @Post('/')
  @CheckPolicies(
    [AuthorizationActions.Create, Sections.ADMIN],
    [AuthorizationActions.Create, Sections.WEBHOOKS]
  )
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async createAWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: WebhooksDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  @Put('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async updateWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UpdateDto
  ) {
    return this._webhooksService.createWebhook(org.id, body);
  }

  // The secret that signs this webhook's deliveries (E2E-08-49). It lets
  // whoever holds it forge a delivery to the customer's endpoint: admins only,
  // like the webhooks themselves, and never in the list above.
  @Get('/:id/secret')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async getSecret(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.getSecret(org.id, id);
  }

  // A new secret; the old one stops working at once.
  @Post('/:id/secret')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async rotateSecret(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.rotateSecret(org.id, id);
  }

  @Delete('/:id')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  async deleteWebhook(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._webhooksService.deleteWebhook(org.id, id);
  }

  @Post('/send')
  @CheckPolicies([AuthorizationActions.Create, Sections.ADMIN])
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async sendWebhook(
    @GetOrgFromRequest() org: Organization,
    @Body() body: any,
    @Query() query: OnlyURL
  ) {
    // User-supplied URL — pin DNS + refuse private ranges so this test call
    // can't be turned into an SSRF probe of the VPC/IMDS.
    if (!(await isSafePublicHttpsUrl(query.url))) {
      return { send: false };
    }
    // A saved webhook's test is signed like its deliveries, so the receiver's
    // check can be tried with it (unknown id: 404).
    const raw = JSON.stringify(body);
    const signature = query.id
      ? {
          [WEBHOOK_ID_HEADER]: query.id,
          [WEBHOOK_SIGNATURE_HEADER]: signWebhookBody(
            (await this._webhooksService.getSecret(org.id, query.id)).secret,
            raw
          ),
        }
      : {};
    try {
      await fetch(query.url, {
        method: 'POST',
        body: raw,
        headers: { 'Content-Type': 'application/json', ...signature },
        dispatcher: ssrfSafeDispatcher,
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
    } catch (err) {
      /** sent **/
    }

    return { send: true };
  }
}
