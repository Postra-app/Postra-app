import { postsCycleWindow } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import {
  PostsRepository,
  PostVersion,
} from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import {
  CreatePostDto,
  saveTypeOfPost,
} from '@gitroom/nestjs-libraries/dtos/posts/create.post.dto';
import dayjs from 'dayjs';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import {
  Integration,
  Post,
  Media,
  From,
  CreationMethod,
  Prisma,
  State,
} from '@prisma/client';
import {
  CountedPost,
  PostCap,
  isPostDate,
  postsCountedBy,
  postsReleasedBy,
} from '@gitroom/nestjs-libraries/database/prisma/posts/post.cap';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';
import { groupBy, shuffle, uniqBy } from 'lodash';
import { v4 as uuidv4 } from 'uuid';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { redactSecretsInJson } from '@gitroom/nestjs-libraries/services/redact.secrets';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import utc from 'dayjs/plugin/utc';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ShortLinkService } from '@gitroom/nestjs-libraries/short-linking/short.link.service';
import { CreateTagDto } from '@gitroom/nestjs-libraries/dtos/posts/create.tag.dto';
import {
  minifyPostsList,
  minifyPosts,
} from '@gitroom/helpers/utils/posts.list.minify';
import { fetchMediaBuffer } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';
import sharp from 'sharp';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { Readable } from 'stream';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
dayjs.extend(utc);
import * as Sentry from '@sentry/nestjs';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
  postId as postIdSearchParam,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
import { AnalyticsData } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { readablePostError } from '@gitroom/nestjs-libraries/database/prisma/posts/post.error.message';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { hasExtension } from '@gitroom/helpers/utils/has.extension';
import { stripLinks } from '@gitroom/helpers/utils/strip.links';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';
import { providerTextLength } from '@gitroom/helpers/utils/count.length';

type PostWithConditionals = Post & {
  integration?: Integration;
  childrenPost: Post[];
};

const postCapException = () =>
  new SubscriptionException({
    section: Sections.POSTS_PER_MONTH,
    action: AuthorizationActions.Create,
  });

@Injectable()
export class PostsService {
  private readonly _logger = new Logger(PostsService.name);
  private storage = UploadFactory.createStorage();
  constructor(
    private _postRepository: PostsRepository,
    private _integrationManager: IntegrationManager,
    private _integrationService: IntegrationService,
    private _mediaService: MediaService,
    private _shortLinkService: ShortLinkService,
    private _openaiService: OpenaiService,
    private _temporalService: TemporalService,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  searchForMissingThreeHoursPosts() {
    return this._postRepository.searchForMissingThreeHoursPosts();
  }

  updatePost(id: string, postId: string, releaseURL: string, orgId?: string) {
    return this._postRepository.updatePost(id, postId, releaseURL, orgId);
  }

  clearReleases(orgId: string, ids: string[]) {
    return this._postRepository.clearReleases(orgId, ids);
  }

  async getMissingContent(
    orgId: string,
    postId: string,
    forceRefresh = false
  ): Promise<{ id: string; url: string }[]> {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || post.releaseId !== 'missing') {
      return [];
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.missing) {
      return [];
    }

    const getIntegration = post.integration!;
    getIntegration.token = AuthService.decryptIntegrationToken(
      getIntegration.token
    );
    if (getIntegration.refreshToken) {
      getIntegration.refreshToken = AuthService.decryptIntegrationToken(
        getIntegration.refreshToken
      );
    }

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    try {
      return await integrationProvider.missing(
        getIntegration.internalId,
        getIntegration.token
      );
    } catch (e) {
      this._logger.warn(`getMissingContent failed: ${(e as Error)?.message ?? e}`);
      // Retry once after a token refresh; a second RefreshToken means the
      // refresh didn't help (revoked scope) — recursing again would loop,
      // refreshing the token on every turn.
      if (e instanceof RefreshToken && !forceRefresh) {
        return this.getMissingContent(orgId, postId, true);
      }
    }

    return [];
  }

  async getPostById(postId: string, orgId: string) {
    return this._postRepository.getPostById(postId, orgId);
  }

  async updateReleaseId(orgId: string, postId: string, releaseId: string) {
    if (typeof releaseId !== 'string' && typeof releaseId !== 'number') {
      throw new BadRequestException('releaseId is required');
    }
    const value = String(releaseId).trim();
    if (!value || value === 'missing' || value.length > 200) {
      throw new BadRequestException('Invalid releaseId');
    }
    const updated = await this._postRepository.updateReleaseId(
      postId,
      orgId,
      value
    );
    if (!updated) {
      throw new NotFoundException('No post waiting for a release id');
    }
    return updated;
  }

  // Whether the post's platform gives apps statistics of a post at all
  // (Telegram, Discord and a few others do not).
  async postAnalyticsOffered(orgId: string, postId: string) {
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post?.integration) {
      return true;
    }
    return !!this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    )?.postAnalytics;
  }

  async checkPostAnalytics(
    orgId: string,
    postId: string,
    date: number,
    forceRefresh = false
  ): Promise<AnalyticsData[] | { missing: true }> {
    // Days to load, as in IntegrationService.checkAnalytics: the public API
    // passes `+date`, so a missing `date` asked the platform for NaN days
    // (E2E-08-57).
    date = date > 0 ? date : 7;
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post || !post.releaseId) {
      return [];
    }

    if (post.releaseId === 'missing') {
      return { missing: true };
    }

    const integrationProvider = this._integrationManager.getSocialIntegration(
      post.integration.providerIdentifier
    );

    if (!integrationProvider.postAnalytics) {
      return [];
    }

    const getIntegration = post.integration!;
    getIntegration.token = AuthService.decryptIntegrationToken(
      getIntegration.token
    );
    if (getIntegration.refreshToken) {
      getIntegration.refreshToken = AuthService.decryptIntegrationToken(
        getIntegration.refreshToken
      );
    }

    if (
      dayjs(getIntegration?.tokenExpiration).isBefore(dayjs()) ||
      forceRefresh
    ) {
      const data = await this._refreshIntegrationService.refresh(
        getIntegration
      );
      if (!data) {
        return [];
      }

      const { accessToken } = data;

      if (accessToken) {
        getIntegration.token = accessToken;

        if (integrationProvider.refreshWait) {
          await timer(10000);
        }
      } else {
        await this._integrationService.disconnectChannel(orgId, getIntegration);
        return [];
      }
    }

    // const getIntegrationData = await ioRedis.get(
    //   `integration:${orgId}:${post.id}:${date}`
    // );
    // if (getIntegrationData) {
    //   return JSON.parse(getIntegrationData);
    // }

    try {
      const loadAnalytics = await integrationProvider.postAnalytics(
        getIntegration.internalId,
        getIntegration.token,
        post.releaseId,
        date,
        post.releaseURL || undefined
      );
      await ioRedis.set(
        `integration:${orgId}:${post.id}:${date}`,
        JSON.stringify(loadAnalytics),
        'EX',
        !process.env.NODE_ENV || process.env.NODE_ENV === 'development'
          ? 1
          : 3600
      );
      return loadAnalytics;
    } catch (e) {
      this._logger.warn(`checkPostAnalytics failed: ${(e as Error)?.message ?? e}`);
      // Retry once, as in getMissingContent.
      if (e instanceof RefreshToken && !forceRefresh) {
        return this.checkPostAnalytics(orgId, postId, date, true);
      }
    }

    return [];
  }

  async getStatistics(orgId: string, id: string) {
    const getPost = await this.getPostsRecursively(id, true, orgId, true);
    const content = getPost.map((p) => p.content);
    const shortLinksTracking = await this._shortLinkService.getStatistics(
      content
    );

    return {
      clicks: shortLinksTracking,
    };
  }

  async mapTypeToPost(
    body: CreatePostDto,
    organization: string,
    replaceDraft: boolean = false
  ): Promise<CreatePostDto> {
    // `posts: {}` has no `.every` and was a 500 before validation (API-12).
    if (
      !Array.isArray(body?.posts) ||
      !body.posts.every((p) => p?.integration?.id)
    ) {
      throw new BadRequestException('All posts must have an integration id');
    }

    const integrationsById = new Map(
      (
        await this._integrationService.getIntegrationsByIds(organization, [
          ...new Set(body.posts.map((post) => post.integration.id)),
        ])
      ).map((integration) => [integration.id, integration])
    );

    const mappedValues = {
      ...body,
      type: replaceDraft ? 'schedule' : body.type,
      posts: body.posts.map((post) => {
        const integration = integrationsById.get(post.integration.id);

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post.integration.id} not found`
          );
        }

        return {
          type: replaceDraft ? 'schedule' : body.type,
          ...post,
          settings: {
            ...(post.settings || ({} as any)),
            __type: integration.providerIdentifier,
          },
        };
      }),
    };

    const validationPipe = new ValidationPipe({
      skipMissingProperties: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    });

    return await validationPipe.transform(mappedValues, {
      type: 'body',
      metatype: CreatePostDto,
    });
  }

  async getPostsRecursively(
    id: string,
    includeIntegration = false,
    orgId?: string,
    isFirst?: boolean
  ): Promise<PostWithConditionals[]> {
    const post = await this._postRepository.getPost(
      id,
      includeIntegration,
      orgId,
      isFirst
    );

    if (!post) {
      return [];
    }

    if (!post.childrenPost?.length) {
      return [post];
    }

    // Fetch the rest of the thread with one query and follow parentPostId in
    // memory (previously one query per thread part).
    const chain = await this._postRepository.getPostsChain(post.group, orgId);
    const byParent = new Map(
      chain.map((p) => [p.parentPostId, p] as const)
    );
    const result: PostWithConditionals[] = [post];
    let next = byParent.get(post.id);
    while (next) {
      result.push(next as PostWithConditionals);
      next = byParent.get(next.id);
    }
    return result;
  }

  async getPosts(orgId: string, query: GetPostsDto) {
    return this._postRepository.getPosts(orgId, query);
  }

  async getPostsMinified(orgId: string, query: GetPostsDto) {
    return minifyPosts({
      posts: await this._postRepository.getPosts(orgId, query),
    });
  }

  async getPostsList(orgId: string, query: GetPostsListDto) {
    return minifyPostsList(
      await this._postRepository.getPostsList(orgId, query)
    );
  }

  async updateMedia(
    orgId: string,
    id: string,
    imagesList: any[],
    convertToJPEG = false
  ) {
    try {
      let imageUpdateNeeded = false;
      const getImageList = await Promise.all(
        (
          await Promise.all(
            (imagesList || []).map(async (p: any) => {
              if (!p.path && p.id) {
                imageUpdateNeeded = true;
                // Org-scoped: a post's stored image list is client-controlled,
                // so a foreign media id must never resolve to another org's
                // asset/URL.
                return this._mediaService.getMediaByIdOrg(orgId, p.id);
              }

              // Posts saved before the flag existed (and any client that
              // stores only the path) carry no origin. YouTube and TikTok have
              // to be told about synthetic media, and the library row is the
              // only place that knows, so ask it rather than publish blind.
              if (p.id && p.aiGenerated === undefined) {
                const row = await this._mediaService.getMediaByIdOrg(
                  orgId,
                  p.id
                );
                return { ...p, aiGenerated: !!row?.aiGenerated };
              }

              return p;
            })
          )
        )
          .filter((m: any) => m && m.path)
          .map((m) => {
            return {
              ...m,
              url:
                m.path.indexOf('http') === -1
                  ? process.env.FRONTEND_URL +
                    '/' +
                    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                    m.path
                  : m.path,
              type: 'image',
              path:
                m.path.indexOf('http') === -1
                  ? process.env.UPLOAD_DIRECTORY + m.path
                  : m.path,
            };
          })
          .map(async (m) => {
            if (!convertToJPEG) {
              return m;
            }

            if (hasExtension(m.path, 'png')) {
              imageUpdateNeeded = true;
              const imageBuffer = await fetchMediaBuffer(m.url);

              // Use sharp to get the metadata of the image
              const buffer = await sharp(imageBuffer, {
                limitInputPixels: 100_000_000,
              })
                .jpeg({ quality: 100 })
                .toBuffer();

              const { path, originalname } = await this.storage.uploadFile({
                buffer,
                mimetype: 'image/jpeg',
                size: buffer.length,
                path: '',
                fieldname: '',
                destination: '',
                stream: new Readable(),
                filename: '',
                originalname: '',
                encoding: '',
              });

              return {
                ...m,
                name: originalname,
                url:
                  path.indexOf('http') === -1
                    ? process.env.FRONTEND_URL +
                      '/' +
                      process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY +
                      path
                    : path,
                type: 'image',
                path:
                  path.indexOf('http') === -1
                    ? process.env.UPLOAD_DIRECTORY + path
                    : path,
              };
            }

            return m;
          })
      );

      if (imageUpdateNeeded) {
        await this._postRepository.updateImages(
          id,
          JSON.stringify(getImageList)
        );
      }

      return getImageList;
    } catch (err: any) {
      return imagesList;
    }
  }

  async getPostGroupDebugExport(orgId: string, group: string) {
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const errors = await this._postRepository.getErrorsByPostIds(
      loadAll.map((p) => p.id)
    );
    const posts = this.arrangePostsByGroup(loadAll, undefined);
    const rootPost = posts[0] as any;

    return {
      type: 'draft' as const,
      shortLink: false,
      date: rootPost.publishDate.toISOString(),
      tags:
        rootPost.tags?.map((t: any) => ({
          value: t.tag.id,
          label: t.tag.name,
        })) || [],
      posts: [
        {
          integration: { id: 'REPLACE_WITH_LOCAL_INTEGRATION_ID' },
          group: rootPost.group,
          settings: JSON.parse(rootPost.settings || '{}'),
          value: posts.map((post) => ({
            content: post.content,
            image: JSON.parse(post.image || '[]'),
            delay: post.delay || 0,
          })),
        },
      ],
      _debug: {
        providerIdentifier: rootPost.integration?.providerIdentifier,
        providerName: rootPost.integration?.name,
        state: rootPost.state,
        error: rootPost.error,
        // Second line of defence: rows written before E2E-09-01 was fixed
        // still hold plaintext tokens, and this export goes straight to a
        // clipboard and into a support thread.
        errors: errors.map((e) => ({
          message: redactSecretsInJson(e.message),
          platform: e.platform,
          body: redactSecretsInJson(e.body),
          createdAt: e.createdAt,
        })),
        originalGroup: group,
        originalPublishDate: rootPost.publishDate,
        exportedAt: new Date().toISOString(),
      },
    };
  }

  // The repository includes the full Integration row (publishing needs the
  // token); the editor API response must not carry credential material — nor
  // the raw Temporal failure in Post.error, only its sentence.
  private stripIntegrationSecrets<
    T extends { integration?: any; error?: string | null }
  >(post: T): T {
    const readable =
      post && 'error' in post
        ? { ...post, error: readablePostError(post.error) }
        : post;
    if (!readable?.integration) {
      return readable;
    }
    const {
      token,
      refreshToken,
      customInstanceDetails,
      ...integration
    } = readable.integration;
    return { ...readable, integration };
  }

  async getPostsByGroup(orgId: string, group: string) {
    const convertToJPEG = false;
    const loadAll = await this._postRepository.getPostsByGroup(orgId, group);
    const posts = this.arrangePostsByGroup(loadAll, undefined);

    // Same shape as `getPost` below, and it needed the same guard: a group that
    // resolves to nothing fell through to `posts[0].integrationId` and threw an
    // unhandled TypeError. Measured on production 2026-09-19: a stale group id
    // answered `{"statusCode":500,"message":"Internal server error"}` while the
    // very same id shape on `/posts/:id` already answered 404. The hardening
    // that fixed `getPost` stopped one function short of its twin.
    if (!posts?.length) {
      throw new NotFoundException('Post not found');
    }

    const batch = posts[0].batchId
      ? await this._postRepository.getPostsByBatch(
          orgId,
          posts[0].batchId,
          group
        )
      : [];

    // The other channels the post was saved with. The editor holds one post
    // per channel, and a channel that repeats differently is a post of its own.
    const siblings = uniqBy(
      Object.values(groupBy(batch, (post) => post.group))
        .map((batchPosts) => this.arrangePostsByGroup(batchPosts, undefined))
        .filter(
          (batchPosts) =>
            batchPosts.length &&
            batchPosts[0].integrationId !== posts[0].integrationId &&
            batchPosts[0].intervalInDays === posts[0].intervalInDays
        ),
      (batchPosts) => batchPosts[0].integrationId
    );

    return {
      ...(await this.groupForEditor(orgId, posts, convertToJPEG)),
      siblings: await Promise.all(
        siblings.map((batchPosts) =>
          this.groupForEditor(orgId, batchPosts, convertToJPEG)
        )
      ),
    };
  }

  // A post as the editor loads it: its channel without the tokens.
  private async groupForEditor(
    orgId: string,
    posts: PostWithConditionals[],
    convertToJPEG = false
  ) {
    return {
      group: posts?.[0]?.group,
      posts: await Promise.all(
        (posts || []).map(async (post) => ({
          ...this.stripIntegrationSecrets(post),
          image: await this.updateMedia(
            orgId,
            post.id,
            JSON.parse(post.image || '[]'),
            convertToJPEG
          ),
        }))
      ),
      integrationPicture: posts[0]?.integration?.picture,
      integration: posts[0].integrationId,
      settings: JSON.parse(posts[0].settings || '{}'),
    };
  }

  arrangePostsByGroup(all: any, parent?: string): PostWithConditionals[] {
    const findAll = all
      .filter((p: any) =>
        !parent ? !p.parentPostId : p.parentPostId === parent
      )
      .map(({ integration, ...all }: any) => ({
        ...all,
        ...(!parent ? { integration } : {}),
      }));

    return [
      ...findAll,
      ...(findAll.length
        ? findAll.flatMap((p: any) => this.arrangePostsByGroup(all, p.id))
        : []),
    ];
  }

  async getPost(orgId: string, id: string, convertToJPEG = false) {
    const posts = await this.getPostsRecursively(id, true, orgId, true);

    // An id that resolves to nothing used to reach `posts[0].integrationId` and
    // throw an unhandled TypeError — a 500 and a Sentry event for what is just
    // a stale or foreign id. `getPostsRecursively` is org-scoped, so any id
    // belonging to another organization lands here too. Two of the four
    // properties below already had optional chaining, which is how it survived:
    // the hardening stopped halfway. Optional chaining on the other two would
    // be worse than a 404 — it answers with an empty post and the composer
    // renders a blank editor as though the post existed.
    if (!posts?.length) {
      throw new NotFoundException('Post not found');
    }

    return this.groupForEditor(orgId, posts, convertToJPEG);
  }

  async getOldPosts(orgId: string, date: string) {
    return this._postRepository.getOldPosts(orgId, date);
  }

  public async updateTags(orgId: string, post: Post[]): Promise<Post[]> {
    const plainText = JSON.stringify(post);
    const extract = Array.from(
      plainText.match(/\(post:[a-zA-Z0-9-_]+\)/g) || []
    );
    if (!extract.length) {
      return post;
    }

    const ids = (extract || []).map((e) =>
      e.replace('(post:', '').replace(')', '')
    );
    const urls = await this._postRepository.getPostUrls(orgId, ids);
    const newPlainText = ids.reduce((acc, value) => {
      const findUrl = urls?.find?.((u) => u.id === value)?.releaseURL || '';
      return acc.replace(
        new RegExp(`\\(post:${value}\\)`, 'g'),
        findUrl.split(',')[0]
      );
    }, plainText);

    return this.updateTags(orgId, JSON.parse(newPlainText) as Post[]);
  }

  public async checkInternalPlug(
    integration: Integration,
    orgId: string,
    id: string,
    settings: any
  ) {
    const plugs = Object.entries(settings).filter(([key]) => {
      return key.indexOf('plug-') > -1;
    });

    if (plugs.length === 0) {
      return [];
    }

    const parsePlugs = plugs.reduce((all, [key, value]) => {
      const [_, name, identifier] = key.split('--');
      all[name] = all[name] || { name };
      all[name][identifier] = value;
      return all;
    }, {} as any);

    const list: {
      name: string;
      integrations: { id: string }[];
      delay: string;
      active: boolean;
    }[] = Object.values(parsePlugs);

    return (list || []).flatMap((trigger) => {
      return (trigger?.integrations || []).flatMap((int) => ({
        type: 'internal-plug',
        post: id,
        originalIntegration: integration.id,
        integration: int.id,
        plugName: trigger.name,
        orgId: orgId,
        delay: +trigger.delay,
        information: trigger,
      }));
    });
  }

  public async checkPlugs(
    orgId: string,
    providerName: string,
    integrationId: string
  ) {
    const loadAllPlugs = this._integrationManager.getAllPlugs();
    const getPlugs = await this._integrationService.getPlugs(
      orgId,
      integrationId
    );

    const currentPlug = loadAllPlugs.find((p) => p.identifier === providerName);

    return getPlugs
      .filter((plug) => {
        return currentPlug?.plugs?.some(
          (p: any) => p.methodName === plug.plugFunction
        );
      })
      .map((plug) => {
        const runPlug = currentPlug?.plugs?.find(
          (p: any) => p.methodName === plug.plugFunction
        )!;
        return {
          type: 'global',
          plugId: plug.id,
          delay: runPlug.runEveryMilliseconds,
          totalRuns: runPlug.totalRuns,
        };
      });
  }

  async deletePost(orgId: string, group: string) {
    const post = await this._postRepository.deletePost(orgId, group);

    if (post?.id) {
      try {
        const workflows = this._temporalService.client
          .getRawClient()
          ?.workflow.list({
            query: `postId="${post.id}" AND ExecutionStatus="Running"`,
          });

        for await (const executionInfo of workflows) {
          try {
            const workflow =
              await this._temporalService.client.getWorkflowHandle(
                executionInfo.workflowId
              );
            if (
              workflow &&
              (await workflow.describe()).status.name !== 'TERMINATED'
            ) {
              await workflow.terminate();
            }
          } catch (err) {}
        }
      } catch (err) {}
    }

    // Used to answer `{ error: true }` whether the delete worked or the group
    // never existed, so no caller could tell the two apart.
    return { deleted: !!post?.id, id: post?.id ?? null };
  }

  channelsWithRecentAutopost(
    orgId: string,
    integrationIds: string[],
    url: string
  ) {
    return this._postRepository.channelsWithRecentAutopost(
      orgId,
      integrationIds,
      url
    );
  }

  countExistingPosts(orgId: string, ids: string[]) {
    return this._postRepository.countExistingPosts(orgId, ids);
  }

  /**
   * Whether saving these posts would take the organisation past its monthly
   * post allowance. Each post counts against the billing month of its publish
   * date (now when it has none), and a post already counted there is an edit.
   * A draft being scheduled was counted as an edit too, so at 399 of 400 one
   * request scheduled any number of drafts (E2E-07-34). Without posts (a
   * status change) it asks whether this month has room for one more.
   * `released` are posts of the same save that leave the count (kept as
   * drafts); a post moved to another month leaves its old one.
   */
  async postCapReached(
    orgId: string,
    anchor: Date | string,
    limit: number,
    requested: (Omit<CountedPost, 'date'> & { date?: string | Date })[],
    released: string[] = [],
    tx?: Prisma.TransactionClient
  ) {
    const months = new Map<
      number,
      { start: Date; end: Date; total: number }
    >();
    // A post named without a date (a status change) counts on its own date,
    // and an update keeps a post's state.
    const looked = requested
      .filter((p) => p.id && (!p.date || p.keepsState))
      .map((p) => p.id as string);
    const existing = looked.length
      ? await this._postRepository.getPublishDates(orgId, looked, tx)
      : [];
    const savedOn = new Map(existing.map((p) => [p.id, p.publishDate] as const));
    // A draft or a failed post edited with 'update' stays one, out of the
    // count; it was counted as a new post (Codex).
    const uncounted = new Set(
      existing
        .filter((p) => p.state !== 'QUEUE' && p.state !== 'PUBLISHED')
        .map((p) => p.id)
    );
    const posts = requested.filter(
      (p) => !(p.keepsState && p.id && uncounted.has(p.id))
    );
    if (requested.length && !posts.length) {
      return false;
    }
    for (const post of posts.length ? posts : [{} as (typeof posts)[number]]) {
      const { start, end } = postsCycleWindow(
        anchor,
        post.date || (post.id && savedOn.get(post.id)) || new Date()
      );
      const month = months.get(+start) || { start, end, total: 0 };
      month.total += posts.length ? 1 : 0;
      months.set(+start, month);
    }
    // Every post the save touches, wherever it is counted now: a month
    // gets the ones saved into it and loses the ones leaving it.
    const touched = [
      ...new Set([
        ...requested.map((p) => p.id).filter((id): id is string => !!id),
        ...released,
      ]),
    ];
    for (const { start, end, total } of months.values()) {
      const count = await this._postRepository.countCountedPosts(
        orgId,
        start,
        end,
        undefined,
        tx
      );
      const leaving = touched.length
        ? await this._postRepository.countCountedPosts(
            orgId,
            start,
            end,
            touched,
            tx
          )
        : 0;
      // Editing posts already counted adds nothing, so it goes through at a
      // full month too; a month that does not grow is never refused; with no
      // posts named, one more has to fit.
      const adding = total - leaving;
      if (total ? adding > 0 && count + adding > limit : count >= limit) {
        return true;
      }
    }
    return false;
  }

  private async refuseOverPostCap(
    tx: Prisma.TransactionClient,
    orgId: string,
    cap: PostCap,
    posts: CountedPost[],
    released: string[] = []
  ) {
    await this._postRepository.lockPostCap(tx, orgId);
    if (
      await this.postCapReached(
        orgId,
        cap.anchor,
        cap.limit,
        posts,
        released,
        tx
      )
    ) {
      throw postCapException();
    }
  }

  async countPostsFromDay(orgId: string, date: Date) {
    return this._postRepository.countPostsFromDay(orgId, date);
  }

  getPostByForWebhookId(id: string, integrationId: string) {
    return this._postRepository.getPostByForWebhookId(id, integrationId);
  }

  async startWorkflow(
    taskQueue: string,
    postId: string,
    orgId: string,
    state: State
  ) {
    try {
      const workflows = this._temporalService.client
        .getRawClient()
        ?.workflow.list({
          query: `postId="${postId}" AND ExecutionStatus="Running"`,
        });

      for await (const executionInfo of workflows) {
        try {
          const workflow = await this._temporalService.client.getWorkflowHandle(
            executionInfo.workflowId
          );
          if (
            workflow &&
            (await workflow.describe()).status.name !== 'TERMINATED'
          ) {
            await workflow.terminate();
          }
        } catch (err) {}
      }
    } catch (err) {}

    if (state === 'DRAFT') {
      return;
    }

    try {
      await this._temporalService.client
        .getRawClient()
        ?.workflow.start('postWorkflowV109', {
          workflowId: `post_${postId}`,
          taskQueue: 'main',
          workflowIdConflictPolicy: 'TERMINATE_EXISTING',
          args: [
            {
              taskQueue: taskQueue,
              postId: postId,
              organizationId: orgId,
            },
          ],
          typedSearchAttributes: new TypedSearchAttributes([
            {
              key: postIdSearchParam,
              value: postId,
            },
            {
              key: organizationId,
              value: orgId,
            },
          ]),
        });
    } catch (err) {}
  }

  /**
   * Server-side validation that used to live on the client (`checkValidity` +
   * the manage modal loop). Runs the provider's settings DTO validation, the
   * provider `checkValidity` (media rules) and the empty-content / too-long
   * character checks. Returns one result per post so the frontend can show the
   * same toasts it did before — and so `/posts` can refuse to create invalid
   * posts.
   */
  async validatePosts(
    orgId: string,
    posts: Array<{
      integration: { id: string };
      value: Array<{
        content?: string;
        image?: Array<{ path: string; thumbnail?: string }>;
      }>;
      settings?: any;
    }>
  ) {
    // Both routes read the body as `any`, so a non-array here used to die on
    // `.map` as a 500.
    if (posts != null && !Array.isArray(posts)) {
      throw new BadRequestException('posts must be an array');
    }
    // Each post's value is a list too; `value: {}` died on `.map` (POSTS-13).
    if ((posts || []).some((post) => post?.value != null && !Array.isArray(post.value))) {
      throw new BadRequestException('Each post value must be an array');
    }

    const integrationsById = new Map(
      (
        await this._integrationService.getIntegrationsByIds(orgId, [
          ...new Set(
            (posts || []).map((post) => post?.integration?.id).filter(Boolean)
          ),
        ])
      ).map((integration) => [integration.id, integration])
    );

    return Promise.all(
      (posts || []).map(async (post) => {
        const integration = integrationsById.get(post?.integration?.id);

        if (!integration) {
          throw new BadRequestException(
            `Integration with id ${post?.integration?.id} not found`
          );
        }

        const provider = this._integrationManager.getSocialIntegration(
          integration.providerIdentifier
        );

        let additionalSettings: any[] = [];
        try {
          additionalSettings = JSON.parse(integration.additionalSettings || '[]');
        } catch {
          additionalSettings = [];
        }

        const settings = post.settings || {};
        const media = (post.value || []).map((p) => p.image || []);

        // Settings DTO validation — mirrors the client `form.trigger()`.
        let valid = true;
        let settingsError = '';
        if (provider?.dto) {
          const instance = plainToInstance(provider.dto, settings, {
            enableImplicitConversion: true,
          });
          const validationErrors = await validate(instance as object, {
            skipMissingProperties: false,
          });
          settingsError = this.firstValidationError(validationErrors);
          valid = validationErrors.length === 0;
        }

        // Provider-specific media validation (the old client `checkValidity`).
        let errors: string | true = true;
        try {
          errors = await provider.checkValidity(
            media,
            settings,
            additionalSettings
          );
        } catch (err: any) {
          errors = err?.message || 'Invalid media';
        }

        const maximumCharacters = provider.maxLength(additionalSettings);
        const emptyContent = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          return strip.length === 0 && (a.image || []).length === 0;
        });

        // Counted the way the platform counts (links as 23 on X/Mastodon,
        // graphemes on Bluesky). This used to take max(weighted, raw length),
        // which threw the link weighting away.
        const tooLong = (post.value || []).some((a) => {
          const strip = stripHtmlValidation('normal', a.content || '', true);
          return (
            providerTextLength(integration.providerIdentifier, strip) >
            (maximumCharacters || 1000000)
          );
        });

        return {
          id: integration.id,
          identifier: integration.providerIdentifier,
          name: integration.name,
          valid,
          settingsError,
          errors,
          emptyContent,
          tooLong,
          maximumCharacters,
        };
      })
    );
  }

  /** Returns the first class-validator message (incl. nested children), or ''. */
  private firstValidationError(errors: any[]): string {
    for (const e of errors || []) {
      if (e?.constraints) {
        return Object.values(e.constraints as Record<string, string>)[0] || '';
      }
      const child = e?.children?.length
        ? this.firstValidationError(e.children)
        : '';
      if (child) {
        return child;
      }
    }
    return '';
  }

  // A published post put back in the queue keeps its past date, so the
  // workflow publishes it again at once. Only on an explicit `republish`; the
  // message is the confirmation an API or agent caller never saw
  // (upstream b6310364).
  private guardAgainstRepublish(
    post: {
      state: State;
      publishDate: Date;
      integration?: { name?: string; providerIdentifier: string } | null;
    } | null,
    howToEdit: string
  ) {
    if (post?.state !== 'PUBLISHED') {
      return;
    }
    throw new BadRequestException(
      `This post was already published on ${dayjs
        .utc(post.publishDate)
        .format('YYYY-MM-DD HH:mm')} UTC. Saving it this way would publish it again to ${
        post.integration?.name || post.integration?.providerIdentifier || 'the channel'
      }. To edit it without publishing again, ${howToEdit}. To publish it again on purpose, send republish: true.`
    );
  }

  async createPost(
    orgId: string,
    body: CreatePostDto,
    creationMethod: CreationMethod,
    cap?: PostCap
  ): Promise<any[]> {
    // Every date it saves on, the request's and each channel's ("now" posts
    // go out now): a year out of range was saved, and counted as this month.
    for (const post of body.posts || []) {
      if (
        saveTypeOfPost(body, post) !== 'now' &&
        !isPostDate(post.date || body.date)
      ) {
        throw new BadRequestException('Invalid date');
      }
    }

    // Two people editing one post: the later save used to replace the
    // earlier one without a word, and an agency lost a colleague's changes.
    const editedIds = (body.posts || []).flatMap((post) =>
      (post.value || []).map((value) => value.id).filter(Boolean)
    ) as string[];
    // Each channel against the version it was read at.
    const versions = (body.posts || [])
      .map((post) => ({
        ids: (post.value || [])
          .map((value) => value.id)
          .filter(Boolean) as string[],
        expectedUpdatedAt: post.expectedUpdatedAt || body.expectedUpdatedAt,
      }))
      .filter(
        (v): v is PostVersion => !!v.ids.length && !!v.expectedUpdatedAt
      );
    // Refused here before any work is done; the write below checks again
    // with the rows locked, which is what stops two saves at once.
    if (versions.length) {
      await this._postRepository.refuseIfChangedSince(orgId, versions);
    }

    // Every post of the request is checked before the first one is written.
    if (!body.republish) {
      for (const post of body.posts) {
        const kind = saveTypeOfPost(body, post);
        const existingId = post.value?.[0]?.id;
        if (existingId && (kind === 'now' || kind === 'schedule')) {
          this.guardAgainstRepublish(
            await this._postRepository.getPostById(existingId, orgId),
            `save it with type 'update'`
          );
        }
      }
    }

    // Content first: shortening links calls out, and that must not happen
    // while the rows are locked.
    for (const post of body.posts) {
      const provider = this._integrationManager.getSocialIntegration(
        (post.settings as any)?.__type
      );
      const removeLinks = !!provider?.stripLinks?.();

      const messages = (post.value || []).map((p) => p.content);
      // No point shortlinking links on platforms that strip them out anyway
      const updateContent =
        !body.shortLink || removeLinks
          ? messages
          : await this._shortLinkService.convertTextToShortLinks(
              orgId,
              messages
            );

      post.value = (post.value || []).map((p, i) => ({
        ...p,
        content: removeLinks ? stripLinks(updateContent[i]) : updateContent[i],
      }));
    }

    // Every channel in one transaction, behind the locks and the version
    // check of lockForSave. Written one transaction per channel, a save refused (or
    // failing) on the second channel left the first one saved, and already
    // publishing.
    // "Now" once, for the count and the save alike: counted to the second
    // and saved to the minute, a post at the start of a billing month
    // counted in one month and was saved in the one before (Codex).
    const now = dayjs().format('YYYY-MM-DDTHH:mm:00');
    const counted = cap ? postsCountedBy(body, true, undefined, now) : [];
    const written = await this._postRepository.transaction(async (tx) => {
      // The guard counted outside any lock, so two saves at once could both
      // take the last post of the month (Codex). Counted again here, behind a
      // lock of the organisation taken before the rows'.
      if (cap && counted.length) {
        await this.refuseOverPostCap(
          tx,
          orgId,
          cap,
          counted,
          postsReleasedBy(body)
        );
      }
      await this._postRepository.lockForSave(tx, orgId, editedIds, versions);

      // The channels of one save share a batch, so opening one of them in the
      // editor brings the others (an edited post keeps its own batch).
      const batchId = uuidv4();
      const saved = [];
      for (const post of body.posts) {
        const kind = saveTypeOfPost(body, post) as CreatePostDto['type'];
        const { posts } = await this._postRepository.createOrUpdatePost(
          kind,
          orgId,
          kind === 'now' ? now : post.date || body.date,
          post,
          post.tags || body.tags,
          creationMethod,
          body.inter,
          tx,
          batchId
        );
        saved.push({ post, posts });
      }
      return saved;
    });

    const postList = [];
    for (const { post, posts } of written) {
      if (!posts?.length) {
        return [] as any[];
      }
      const kind = saveTypeOfPost(body, post);

      // The publish guard skips a post that already has a release, so a
      // republish saved with "Update" (type 'schedule') went nowhere. Clear it,
      // as "Post now" on a published post already did in the workflow.
      if (body.republish && kind !== 'draft' && kind !== 'update') {
        await this._postRepository.clearReleases(
          orgId,
          posts.map((p) => p.id)
        );
      }

      if (kind !== 'update') {
        this.startWorkflow(
          post.settings.__type.split('-')[0].toLowerCase(),
          posts[0].id,
          orgId,
          posts[0].state
        ).catch((err) => {});
      }

      Sentry.metrics.count('post_created', 1);
      postList.push({
        postId: posts[0].id,
        integration: post.integration.id,
      });
    }

    return postList;
  }

  async separatePosts(content: string, len: number, orgId?: string) {
    return this._openaiService.separatePosts(content, len, orgId);
  }

  async changeState(id: string, state: State, err?: any, body?: any) {
    return this._postRepository.changeState(id, state, err, body);
  }

  async changePostStatus(
    orgId: string,
    id: string,
    status: 'draft' | 'schedule',
    republish = false,
    cap?: PostCap
  ) {
    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new NotFoundException('Post not found');
    }
    if (status === 'schedule' && !republish) {
      this.guardAgainstRepublish(getPostById, 'leave its status as it is');
    }

    const state: State = status === 'draft' ? 'DRAFT' : 'QUEUE';
    await this._postRepository.transaction(async (tx) => {
      // Counted and scheduled behind one lock, like a save (Codex).
      if (cap && state === 'QUEUE') {
        await this.refuseOverPostCap(tx, orgId, cap, [{ id }]);
      }
      await this._postRepository.changeState(
        id,
        state,
        undefined,
        undefined,
        tx
      );
    });
    // The publish guard returns a saved release instead of publishing, so a
    // republish through the public API reported success and sent nothing
    // (POSTS-8). The editor's republish clears it the same way.
    if (status === 'schedule' && republish) {
      // The whole thread: comments with a saved release were skipped and
      // reported under the old post.
      await this._postRepository.clearGroupReleases(orgId, getPostById.group);
    }

    try {
      await this.startWorkflow(
        getPostById.integration.providerIdentifier.split('-')[0].toLowerCase(),
        getPostById.id,
        orgId,
        state
      );
    } catch (err) {}

    return { id, state };
  }

  async changeDate(
    orgId: string,
    id: string,
    date: string,
    action: 'schedule' | 'update' = 'update',
    republish = false,
    cap?: PostCap
  ) {
    // Both used to surface as 500s: garbage reached Prisma as Invalid Date, and
    // a post from another org (or none) came back null.
    // And a date the database cannot hold (years out of range) was a 500.
    if (typeof date !== 'string' || !isPostDate(date)) {
      throw new BadRequestException('Invalid date');
    }

    const getPostById = await this._postRepository.getPostById(id, orgId);
    if (!getPostById) {
      throw new NotFoundException('Post not found');
    }
    if (action === 'schedule' && !republish) {
      this.guardAgainstRepublish(getPostById, `use action 'update'`);
    }

    // A post that counts (scheduled, or scheduled by this move) counts
    // against the month it moves to: moving one from an emptier month into
    // a full one went past the allowance (Codex on E2E-07-34). A draft stays
    // a draft whatever the action (the calendar drags drafts with
    // "schedule"), and a failed post moved with "update" stays out of the
    // count.
    // schedule: Set status to QUEUE and change date (reschedule the post)
    // update: Just change the date without changing the status
    const newDate = await this._postRepository.transaction(async (tx) => {
      // Counted and moved behind one lock: two moves at once both found the
      // last post of the month free; and the state is read behind it too, or
      // a draft scheduled meanwhile moved as a draft (Codex).
      let state = getPostById.state;
      if (cap) {
        await this._postRepository.lockPostCap(tx, orgId);
        state =
          (await this._postRepository.getPostState(tx, orgId, id)) || state;
        const counts =
          state === 'QUEUE' ||
          state === 'PUBLISHED' ||
          (action === 'schedule' && state !== 'DRAFT');
        if (
          counts &&
          (await this.postCapReached(
            orgId,
            cap.anchor,
            cap.limit,
            [{ id, date }],
            [],
            tx
          ))
        ) {
          throw postCapException();
        }
      }
      return this._postRepository.changeDate(
        orgId,
        id,
        date,
        state === 'DRAFT',
        action,
        tx
      );
    });

    // A new date for a post still waiting to go out has to reach its
    // workflow, which otherwise kept sleeping until the old time and
    // published then (POSTS-7). A published post only changes on the
    // calendar.
    const waiting =
      getPostById.state === 'QUEUE' && !getPostById.releaseId;
    if (action === 'schedule' || waiting) {
      try {
        await this.startWorkflow(
          getPostById.integration.providerIdentifier
            .split('-')[0]
            .toLowerCase(),
          getPostById.id,
          orgId,
          getPostById.state === 'DRAFT' ? 'DRAFT' : 'QUEUE'
        );
      } catch (err) {}
    }

    return newDate;
  }

  async generatePostsDraft(orgId: string, body: CreateGeneratedPostsDto) {
    const getAllIntegrations = (
      await this._integrationService.getIntegrationsList(orgId)
    ).filter((f) => !f.disabled && f.providerIdentifier !== 'reddit');

    // const posts = chunk(body.posts, getAllIntegrations.length);
    const allDates = dayjs()
      .isoWeek(body.week)
      .year(body.year)
      .startOf('isoWeek');

    const dates = [...new Array(7)].map((_, i) => {
      return allDates.add(i, 'day').format('YYYY-MM-DD');
    });

    const findTime = (): string => {
      const totalMinutes = Math.floor(Math.random() * 144) * 10;

      // Convert total minutes to hours and minutes
      const hours = Math.floor(totalMinutes / 60);
      const minutes = totalMinutes % 60;

      // Format hours and minutes to always be two digits
      const formattedHours = hours.toString().padStart(2, '0');
      const formattedMinutes = minutes.toString().padStart(2, '0');
      const randomDate =
        shuffle(dates)[0] + 'T' + `${formattedHours}:${formattedMinutes}:00`;

      if (dayjs(randomDate).isBefore(dayjs())) {
        return findTime();
      }

      return randomDate;
    };

    for (const integration of getAllIntegrations) {
      for (const toPost of body.posts) {
        const group = makeId(10);
        const randomDate = findTime();

        await this.createPost(
          orgId,
          {
            type: 'draft',
            date: randomDate,
            order: '',
            shortLink: false,
            tags: [],
            posts: [
              {
                group,
                integration: {
                  id: integration.id,
                },
                settings: {
                  __type: integration.providerIdentifier as any,
                  title: '',
                  tags: [],
                  subreddit: [],
                },
                value: [
                  ...toPost.list.map((l) => ({
                    id: '',
                    content: l.post,
                    delay: 0,
                    image: [],
                  })),
                  {
                    id: '',
                    delay: 0,
                    content: `Check out the full story here:\n${
                      body.postId || body.url
                    }`,
                    image: [],
                  },
                ],
              },
            ],
          },
          'WEB'
        );
      }
    }
  }

  findAllExistingCategories() {
    return this._postRepository.findAllExistingCategories();
  }

  findAllExistingTopicsOfCategory(category: string) {
    return this._postRepository.findAllExistingTopicsOfCategory(category);
  }

  findPopularPosts(category: string, topic?: string) {
    return this._postRepository.findPopularPosts(category, topic);
  }

  async findFreeDateTime(orgId: string, integrationId?: string) {
    const times = await this._integrationService.findFreeDateTime(
      orgId,
      integrationId
    );
    // No posting times means a channel outside this org, an unknown id, or an
    // org without channels. Walking the calendar would then never find a slot
    // and loop forever, one query per day.
    if (!times.length) {
      throw new NotFoundException('No posting times for this channel');
    }
    return this.findFreeDateTimeFrom(orgId, times, dayjs.utc().startOf('day'));
  }

  async createPopularPosts(post: {
    category: string;
    topic: string;
    content: string;
    hook: string;
  }) {
    return this._postRepository.createPopularPosts(post);
  }

  private async findFreeDateTimeFrom(
    orgId: string,
    times: number[],
    start: dayjs.Dayjs
  ): Promise<string> {
    // A year ahead is far past any real calendar; stop there rather than spin.
    for (let day = 0; day < 366; day++) {
      const date = start.add(day, 'day');
      const free = await this._postRepository.getPostsCountsByDates(
        orgId,
        times,
        date
      );
      if (free.length) {
        return date
          .clone()
          .add(Math.min(...free), 'minutes')
          .format('YYYY-MM-DDTHH:mm:00');
      }
    }
    throw new NotFoundException('No free slot in the next year');
  }

  getComments(postId: string) {
    return this._postRepository.getComments(postId);
  }

  getTags(orgId: string) {
    return this._postRepository.getTags(orgId);
  }

  createTag(orgId: string, body: CreateTagDto) {
    return this._postRepository.createTag(orgId, body);
  }

  async editTag(id: string, orgId: string, body: CreateTagDto) {
    const tag = await this._postRepository.editTag(id, orgId, body);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }

  async deleteTag(id: string, orgId: string) {
    const tag = await this._postRepository.deleteTag(id, orgId);
    if (!tag) {
      throw new NotFoundException('Tag not found');
    }
    return tag;
  }

  async createComment(
    orgId: string,
    userId: string,
    postId: string,
    comment: string
  ) {
    // The post must belong to the caller's org — otherwise a user could
    // inject comments onto another org's post (they surface on that org's
    // shared preview).
    const post = await this._postRepository.getPostById(postId, orgId);
    if (!post) {
      // A plain Error here answered 500 for another org's post.
      throw new NotFoundException('Post not found');
    }
    return this._postRepository.createComment(orgId, userId, postId, comment);
  }
}
