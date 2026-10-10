import { PermissionsService } from '@gitroom/backend/services/auth/permissions/permissions.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  NotFoundException,
} from '@nestjs/common';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetMediaDto } from '@gitroom/nestjs-libraries/dtos/media/get.media.dto';
import { toPublicMedia } from '@gitroom/nestjs-libraries/database/prisma/media/public.media';
import { ChangePostStatusDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.status.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { UploadDto } from '@gitroom/nestjs-libraries/dtos/media/upload.dto';
import {
  originalNameFromUrl,
  originalNameOfFile,
} from '@gitroom/nestjs-libraries/upload/original.name';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@gitroom/nestjs-libraries/dtos/notifications/get.notifications.dto';
import { Readable } from 'stream';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { readResponseCapped } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';
// undici's own fetch — Node's global fetch can't drive the undici-package
// dispatcher below (throws "invalid onRequestStart method"); see design-render.
import { fetch } from 'undici';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';

const PUBLIC_API_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);
import * as Sentry from '@sentry/nestjs';
import {
  socialIntegrationList,
  IntegrationManager,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { PostValidationException } from '@gitroom/backend/api/routes/posts.validation.exception';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

@ApiTags('Public API')
@Controller('/public/v1')
export class PublicIntegrationsController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService,
    private _permissionsService: PermissionsService
  ) {}

  @Post('/upload')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    // Storage renames the file; the name it came with is what the library
    // search looks at (E2E-08-58).
    const originalName = originalNameOfFile(file.originalname);
    const getFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName
    );
  }

  @Post('/upload-from-url')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const response = await fetch(body.url, {
      // @ts-ignore — undici option, not in lib.dom fetch types
      dispatcher: ssrfSafeDispatcher,
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      throw new HttpException({ msg: 'Failed to fetch URL' }, 400);
    }
    let buffer: Buffer;
    try {
      buffer = await readResponseCapped(response as any);
    } catch (err) {
      throw new HttpException({ msg: (err as Error).message }, 400);
    }
    const detected = await fromBuffer(buffer);
    if (!detected || !PUBLIC_API_ALLOWED_MIME.has(detected.mime)) {
      throw new HttpException({ msg: 'Unsupported file type.' }, 400);
    }
    const mimetype = detected.mime;
    const ext = detected.ext;

    const getFile = await this.storage.uploadFile({
      buffer,
      mimetype,
      size: buffer.length,
      path: '',
      fieldname: '',
      destination: '',
      stream: new Readable(),
      filename: '',
      originalname: `upload.${ext}`,
      encoding: '',
    });

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalNameFromUrl(body.url, ext)
    );
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  // The organisation's media library, newest first, 18 per page (upstream
  // 5cd4de2f + 063ee509, 4be38e1a: validated page, media fields only).
  @Get('/media')
  async getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetMediaDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const { pages, results } = await this._mediaService.getMedia(
      org.id,
      query.page ?? 1,
      query.search
    );
    return { pages, results: results.map(toPublicMedia) };
  }

  @Get('/posts')
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetPostsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const posts = await this._postsService.getPosts(org.id, query);
    return {
      posts,
      // comments,
    };
  }

  @Post('/posts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const body = await this._postsService.mapTypeToPost(
      {
        ...rawBody,
        // A date, a type and tags per channel are editor features (a post
        // saved for several channels, edited later); the public API keeps one
        // of each per request.
        posts: Array.isArray(rawBody?.posts)
          ? rawBody.posts.map((post: any) => {
              if (!post || typeof post !== 'object') return post;
              const { date, type, tags, ...rest } = post;
              return rest;
            })
          : rawBody?.posts,
      },
      org.id,
      rawBody.type === 'draft'
    );
    body.type = rawBody.type;
    // A draft is checked as a scheduled post above, then saved as a draft.
    for (const post of body.posts) {
      post.type = body.type;
    }

    if (
      process.env.RESTRICT_UPLOAD_DOMAINS &&
      body.posts.some((p) =>
        p.value.some((a) =>
          a.image.some(
            (i) => i.path.indexOf(process.env.RESTRICT_UPLOAD_DOMAINS) === -1
          )
        )
      )
    ) {
      throw new HttpException(
        {
          msg: `All media must be uploaded through our upload API route and contain the domain: ${process.env.RESTRICT_UPLOAD_DOMAINS}`,
        },
        400
      );
    }

    // Server-side validation — same rules as the dashboard, surfaced as a
    // readable 400 (see PostValidationExceptionFilter).
    const validation = await this._postsService.validatePosts(
      org.id,
      body.posts
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

    if (body.type !== 'draft') {
      for (const item of validation) {
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

    const allowedCreationMethods = ['CLI', 'API'] as const;
    const creationMethod = allowedCreationMethods.includes(
      rawBody.creationMethod
    )
      ? (rawBody.creationMethod as 'CLI' | 'API')
      : 'API';

    return this._postsService.createPost(
      org.id,
      body,
      creationMethod,
      await this._permissionsService.postCap(org.id, org.createdAt)
    );
  }

  @Delete('/posts/:id')
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getPostById = await this._postsService.getPost(org.id, id);
    return this._postsService.deletePost(org.id, getPostById.group);
  }

  @Delete('/posts/group/:group')
  deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.deletePost(org.id, group);
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { connected: true };
  }

  @Get('/integrations')
  async listIntegration(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return (await this._integrationService.getIntegrationsList(org.id)).map(
      (org) => ({
        id: org.id,
        name: org.customName || org.name,
        identifier: org.providerIdentifier,
        picture: org.picture,
        disabled: org.disabled,
        profile: org.profile,
        customer: org.customer
          ? {
              id: org.customer.id,
              name: org.customer.name,
            }
          : undefined,
      })
    );
  }

  @Get('/social/:integration')
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    // `refresh` skips the gates below, so it has to name a channel this org
    // already has on this platform, as in the dashboard (the callback checks
    // it again, but only after the customer consented at the platform).
    if (
      refresh &&
      !(await this._integrationService.hasChannel(org.id, integration, refresh))
    ) {
      throw new HttpException('The channel to reconnect was not found', 404);
    }

    // Same plan gate as the dashboard: without it a key on a lower plan gets
    // an auth URL, the customer consents at the platform, and only the
    // callback refuses the channel.
    if (process.env.STRIPE_PUBLISHABLE_KEY && !refresh) {
      // @ts-ignore subscription is attached by the public auth middleware
      const tier = org?.subscription?.subscriptionTier || 'FREE';
      const allowed =
        pricing[tier]?.allowedProviders || pricing.FREE.allowedProviders;
      if (!allowed.includes(integration)) {
        throw new HttpException(
          `The ${integration} channel isn't included in your plan - upgrade to connect it.`,
          402
        );
      }
    }

    // A platform still "Coming soon" takes no new channels (E2E-08-50);
    // after the plan gate, so a plan without it still answers 402.
    if (!refresh && !this._integrationManager.isOffered(integration)) {
      throw new HttpException(
        `The ${integration} channel isn't available yet.`,
        403
      );
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        {
          msg: 'This integration requires an external URL and is not supported via the public API',
        },
        400
      );
    }

    try {
      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);

      return { url };
    } catch (err) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginated(
      org.id,
      query.page ?? 0
    );
  }

  @Post('/generate-video')
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/video/function')
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  videoFunction(@Body() body: VideoFunctionDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.videoFunction(
      body.identifier,
      body.functionName,
      body.params
    );
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postsService.deletePost(org.id, post.group).catch(() => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );
    if (!loadIntegration) {
      throw new NotFoundException('Channel not found');
    }

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = socialIntegrationList.find(
      (p) => p.identifier === loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  @Throttle({ default: { ttl: 300_000, limit: 30 } })
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  // A draft costs nothing; scheduling it counts against the month, which this
  // route used to skip (E2E-07-22). Moving a post back to draft stays free.
  @Put('/posts/:id/status')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async changePostStatus(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: ChangePostStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.changePostStatus(
      org.id,
      id,
      body.status,
      body.republish === true,
      await this._permissionsService.postCap(org.id, org.createdAt)
    );
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Get('/analytics/:integration')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/analytics/post/:postId')
  @Throttle({ default: { ttl: 300_000, limit: 60 } })
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Post('/integration-trigger/:id')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { methodName: string; data: Record<string, string> }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider = socialIntegrationList.find(
      (p) => p.identifier === getIntegration.providerIdentifier
    )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 404);
    }

    while (true) {
      try {
        // @ts-ignore
        const result = await integrationProvider[body.methodName](
          getIntegration.token,
          body.data || {},
          getIntegration.internalId,
          getIntegration
        );

        return { output: result };
      } catch (err) {
        if (err instanceof RefreshToken) {
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          const { accessToken } = data;

          if (accessToken) {
            getIntegration.token = accessToken;

            if (integrationProvider.refreshWait) {
              await timer(10000);
            }

            continue;
          }
        }
        throw new HttpException({ msg: 'Unexpected error' }, 500);
      }
    }
  }
}
