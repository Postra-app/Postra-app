import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Throttle } from '@nestjs/throttler';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
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
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { AutopostService } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.service';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import { OnlyURL } from '@gitroom/nestjs-libraries/dtos/webhooks/webhooks.dto';

@ApiTags('Autopost')
@Controller('/autopost')
export class AutopostController {
  constructor(
    private _autopostsService: AutopostService,
    private _permissionsService: PermissionsService
  ) {}

  @Get('/')
  async getAutoposts(@GetOrgFromRequest() org: Organization) {
    return this._autopostsService.getAutoposts(org.id);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.AUTOPOST])
  async createAutopost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AutopostDto
  ) {
    // The guard counted the feeds before this request; two at once both saw
    // a free one and both were created (AI-6). Counted again, one at a time.
    const lock = `autopost-create:${org.id}`;
    if ((await ioRedis.set(lock, '1', 'EX', 15, 'NX')) !== 'OK') {
      throw new SubscriptionException({
        section: Sections.AUTOPOST,
        action: AuthorizationActions.Create,
      });
    }
    try {
      await this.requireAutopost(org, AuthorizationActions.Create);
      return await this._autopostsService.createAutopost(org.id, body);
    } finally {
      await ioRedis.del(lock).catch(() => undefined);
    }
  }

  @Put('/:id')
  @CheckPolicies([AuthorizationActions.Update, Sections.AUTOPOST])
  async updateAutopost(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AutopostDto,
    @Param('id') id: string
  ) {
    return this._autopostsService.createAutopost(org.id, body, id);
  }

  @Delete('/:id')
  async deleteAutopost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._autopostsService.deleteAutopost(org.id, id);
  }

  @Post('/:id/active')
  async changeActive(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('active') active: boolean
  ) {
    // Switching a feed on needs a plan with Auto Post; a feed made on Pro
    // could be restarted after a downgrade (BILL-7). Switching off is always
    // allowed, so a plan change never leaves a feed nobody can stop.
    if (active) {
      await this.requireAutopost(org, AuthorizationActions.Update);
      // And only up to the plan's number of running feeds: the ones a
      // downgrade switched off could all be switched on again (E2E-07-33).
      if (process.env.STRIPE_PUBLISHABLE_KEY) {
        // @ts-ignore subscription is attached to the org by the auth middleware
        const tier = org?.subscription?.subscriptionTier || 'FREE';
        const limit = pricing[tier]?.autoPostLimit ?? 0;
        const running = (await this._autopostsService.getAutoposts(org.id))
          .filter((f) => f.active && f.id !== id).length;
        if (running >= limit) {
          throw new SubscriptionException({
            section: Sections.AUTOPOST,
            action: AuthorizationActions.Create,
          });
        }
      }
    }
    return this._autopostsService.changeActive(org.id, id, active);
  }

  @Post('/send')
  @Throttle({ default: { ttl: 300_000, limit: 10 } })
  async sendWebhook(@Query() query: OnlyURL) {
    return this._autopostsService.loadXML(query.url);
  }

  private async requireAutopost(
    org: Organization,
    action: AuthorizationActions
  ) {
    const section = Sections.AUTOPOST;
    const ability = await this._permissionsService.check(
      org.id,
      org.createdAt,
      // @ts-ignore — the org from the request carries the caller's role
      org.users[0].role,
      [[action, section]],
      undefined,
      org.isTrailing
    );
    if (!ability.can(action, section)) {
      throw new SubscriptionException({ section, action });
    }
  }
}
