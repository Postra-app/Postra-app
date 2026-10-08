import { Throttle } from '@nestjs/throttler';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { ApiTags } from '@nestjs/swagger';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Analytics')
@Controller('/analytics')
export class AnalyticsController {
  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService
  ) {}

  @Get('/:integration')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/post/:postId')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    const analytics = await this._postsService.checkPostAnalytics(
      org.id,
      postId,
      +date
    );
    // Said apart from "none yet", so the editor can tell the customer the
    // platform shares none (the public API keeps its empty list).
    if (
      Array.isArray(analytics) &&
      !analytics.length &&
      !(await this._postsService.postAnalyticsOffered(org.id, postId))
    ) {
      return { unsupported: true };
    }
    return analytics;
  }
}
