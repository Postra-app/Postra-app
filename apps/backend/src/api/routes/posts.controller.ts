import dayjs from 'dayjs';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { Throttle } from '@nestjs/throttler';
import { AccountAgeGuard } from '@gitroom/backend/services/auth/account-age.guard';
import {
  Body,
  Headers,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization, User } from '@prisma/client';
import { saveTypeOfPost } from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { ApiTags } from '@nestjs/swagger';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';
import { Response } from 'express';
import { GetUserFromRequest } from '@gitroom/nestjs-libraries/user/user.from.request';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import { CreateCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.comment.dto';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';

@ApiTags('Posts')
@Controller('/posts')
export class PostsController {
  constructor(
    private _postsService: PostsService,
    private _agentGraphService: AgentGraphService,
    private _shortLinkService: ShortLinkService
  ) {}

  @Get('/:id/statistics')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/:id/missing')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Post('/should-shortlink')
  async shouldShortlink(@Body() body: { messages: string[] }) {
    return { ask: this._shortLinkService.askShortLinkedin(body.messages) };
  }

  @Post('/:id/comments')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('id') id: string,
    @Body() body: CreateCommentDto
  ) {
    return this._postsService.createComment(org.id, user.id, id, body.comment);
  }

  @Get('/tags')
  async getTags(@GetOrgFromRequest() org: Organization) {
    return { tags: await this._postsService.getTags(org.id) };
  }

  @Post('/tags')
  async createTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto
  ) {
    return this._postsService.createTag(org.id, body);
  }

  @Put('/tags/:id')
  async editTag(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateTagDto,
    @Param('id') id: string
  ) {
    return this._postsService.editTag(id, org.id, body);
  }

  @Delete('/tags/:id')
  async deleteTag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._postsService.deleteTag(id, org.id);
  }

  @Get('/')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    return this._postsService.getPostsMinified(org.id, query);
  }

  @Get('/find-slot')
  async findSlot(@GetOrgFromRequest() org: Organization) {
    return { date: await this._postsService.findFreeDateTime(org.id) };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/list')
  async getPostsList(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsListDto
  ) {
    return this._postsService.getPostsList(org.id, query);
  }

  @Get('/old')
  oldPosts(
    @GetOrgFromRequest() org: Organization,
    @Query('date') date: string
  ) {
    return this._postsService.getOldPosts(org.id, date);
  }

  @Get('/group/:group/debug-export')
  async getPostGroupDebugExport(
    @GetOrgFromRequest() org: Organization,
    @GetUserFromRequest() user: User,
    @Param('group') group: string
  ) {
    if (!user.isSuperAdmin) {
      throw new HttpException('Forbidden', 403);
    }
    return this._postsService.getPostGroupDebugExport(org.id, group);
  }

  @Get('/group/:group')
  getPostsByGroup(@GetOrgFromRequest() org: Organization, @Param('group') group: string) {
    return this._postsService.getPostsByGroup(org.id, group);
  }

  @Get('/:id')
  getPost(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._postsService.getPost(org.id, id);
  }

  @Post('/valid')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  async validatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    return this._postsService.validatePosts(org.id, rawBody?.posts || []);
  }

  @Post('/')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any,
    // The native app sends `x-client: mobile`; without reading it here every
    // post from a phone was filed as WEB and the two were indistinguishable.
    @Headers('x-client') client?: string
  ) {
    // Server-side validation — never trust the client to have validated.
    const validation = await this._postsService.validatePosts(
      org.id,
      rawBody?.posts || []
    );

    const fail = (item: (typeof validation)[number], error: string) => {
      throw new PostValidationException({
        provider: item.identifier,
        name: item.name,
        error,
      });
    };

    for (const item of validation) {
      if (item.emptyContent) {
        fail(
          item,
          'Your post should have at least one character or one image.'
        );
      }
    }

    // A channel kept as a draft gets these checks once it's scheduled.
    for (const [index, item] of validation.entries()) {
      if (saveTypeOfPost(rawBody, rawBody?.posts?.[index]) !== 'draft') {
        if (!item.valid) {
          fail(item, item.settingsError || 'Please fix your settings');
        }
        if (item.errors !== true) {
          fail(item, item.errors as string);
        }
        if (item.tooLong) {
          fail(item, 'post is too long, please fix it');
        }
      }
    }

    const body = await this._postsService.mapTypeToPost(rawBody, org.id);
    return this._postsService.createPost(
      org.id,
      body,
      client === 'mobile' ? 'MOBILE' : 'WEB'
    );
  }

  @Post('/generator/draft')
  @Throttle({ default: { ttl: 300000, limit: 20 } })
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  generatePostsDraft(
    @GetOrgFromRequest() org: Organization,
    @Body() body: CreateGeneratedPostsDto
  ) {
    return this._postsService.generatePostsDraft(org.id, body);
  }

  @Post('/generator')
  @Throttle({ default: { ttl: 300000, limit: 10 } })
  @UseGuards(AccountAgeGuard)
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async generatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratorDto,
    @Res({ passthrough: false }) res: Response
  ) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    for await (const event of this._agentGraphService.start(org.id, body)) {
      res.write(JSON.stringify(event) + '\n');
    }

    res.end();
  }

  @Delete('/:group')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    return this._postsService.deletePost(org.id, group);
  }

  @Put('/:id/date')
  @Throttle({ default: { ttl: 300_000, limit: 120 } })
  async changeDate(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('date') date: string,
    // 'update' when no action is sent: a client that leaves it out must never
    // put a post back in the queue (and so publish it again).
    @Body('action') action: 'schedule' | 'update' = 'update',
    @Body('republish') republish?: boolean
  ) {
    // A post that counts (scheduled, or scheduled by this move) counts
    // against the month it moves to: moving one from an emptier month into
    // a full one went past the allowance (Codex on E2E-07-34).
    // A draft stays a draft whatever the action (the calendar drags drafts
    // with "schedule"), so only a post that already counts is checked. An
    // invalid date is left to changeDate's 400.
    if (
      process.env.STRIPE_PUBLISHABLE_KEY &&
      typeof date === 'string' &&
      dayjs(date).isValid()
    ) {
      const post = await this._postsService.getPostById(id, org.id);
      // Counted already, or put in the queue by this move; an ERROR post
      // moved with "update" stays out of the count (Codex).
      if (
        post &&
        (post.state === 'QUEUE' ||
          post.state === 'PUBLISHED' ||
          (action === 'schedule' && post.state !== 'DRAFT'))
      ) {
        // @ts-ignore subscription is attached to the org by the auth middleware
        const subscription = org.subscription;
        if (
          await this._postsService.postCapReached(
            org.id,
            subscription?.createdAt || org.createdAt,
            pricing[subscription?.subscriptionTier || 'FREE'].posts_per_month,
            [{ id, date }]
          )
        ) {
          throw new SubscriptionException({
            section: Sections.POSTS_PER_MONTH,
            action: AuthorizationActions.Create,
          });
        }
      }
    }
    return this._postsService.changeDate(
      org.id,
      id,
      date,
      action,
      republish === true
    );
  }

  // Splits a long post into a thread with OpenAI: a plan with AI, like every
  // other AI route (E2E-07-35; without it an organisation with no plan spent
  // our key).
  @Post('/separate-posts')
  @Throttle({ default: { ttl: 300000, limit: 20 } })
  @UseGuards(AccountAgeGuard)
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  async separatePosts(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { content: string; len: number }
  ) {
    return this._postsService.separatePosts(body.content, body.len, org.id);
  }
}
