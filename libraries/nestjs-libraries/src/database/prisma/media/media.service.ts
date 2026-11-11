import { HttpException, Injectable, Logger } from '@nestjs/common';
import { posterFor } from '@gitroom/nestjs-libraries/videos/poster/video.poster';
import { createHash } from 'crypto';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { VideoAbstract } from '@gitroom/nestjs-libraries/videos/video.interface';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { timer } from '@gitroom/helpers/utils/timer';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  GeneratePostDesignDto,
  PostDesignPlatform,
} from '@gitroom/nestjs-libraries/dtos/media/generate.post.design.dto';
import { GeneratePostCarouselDto } from '@gitroom/nestjs-libraries/dtos/media/generate.post.carousel.dto';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
import { buildBrandContext } from '@gitroom/nestjs-libraries/openai/brand-prompt';
import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  StudioAiService,
  BrandVoiceResult,
  rankBySimilarity,
} from '@gitroom/nestjs-libraries/studio/studio-ai.service';
import {
  StudioPatch,
  StudioSpec,
} from '@gitroom/nestjs-libraries/studio/studio-spec';
import { DesignRenderService } from '@gitroom/nestjs-libraries/studio/design-render.service';
import { RetouchService } from '@gitroom/nestjs-libraries/studio/retouch.service';
import {
  BACKGROUND_REMOVAL_MAX_BYTES,
  BACKGROUND_REMOVAL_TYPES,
  prepareInput,
  removeBackground,
  UNREADABLE,
} from '@gitroom/nestjs-libraries/studio/background-removal';
import {
  RetouchLevel,
  RetouchSpec,
  RetouchSpecSchema,
} from '@gitroom/nestjs-libraries/studio/retouch-spec';
import {
  DesignSize,
  platformDesignSize,
} from '@gitroom/nestjs-libraries/studio/post-design-spec';
import { templateCorpus } from '@gitroom/nestjs-libraries/studio/template-corpus';
import {
  BrandVoiceCheckDto,
  AiEditTextDto,
  SuggestHashtagsDto,
  RefineDesignDto,
  TemplateSearchDto,
} from '@gitroom/nestjs-libraries/studio/studio.dto';
import {
  AiUsageEvent,
  recordAiUsage,
} from '@gitroom/nestjs-libraries/services/ai-usage.record';
import { MediaType } from '@gitroom/helpers/utils/media.type';
import {
  sizeToRecord,
  storageFullError,
  storageLimit,
} from '@gitroom/nestjs-libraries/database/prisma/media/media.storage';
import {
  ImageOrientation,
  orientationForSize,
} from '@gitroom/nestjs-libraries/openai/image-orientation';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

const POST_DESIGN_BG_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

// Map a social channel to the design format that reads best on it. The design
// generator only uses this as descriptive context; the actual canvas size is
// resolved separately from `platformDesignSize`.
const DESIGN_PLATFORM_BY_SOCIAL: Record<string, PostDesignPlatform> = {
  instagram: 'instagram-feed',
  'instagram-standalone': 'instagram-feed',
  facebook: 'facebook-feed',
  linkedin: 'linkedin-feed',
  tiktok: 'tiktok-cover',
  x: 'x-post',
  twitter: 'x-post',
  threads: 'instagram-feed',
  mastodon: 'instagram-feed',
  bluesky: 'instagram-feed',
  pinterest: 'pinterest-pin',
};
const TEMPLATE_EMBED_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
const RECENT_POSTS_FOR_VOICE = 5;

import { fromBuffer as fileTypeFromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';

// See generateVideo: how long a clip being made blocks the same request
// (longer than the ~10 minute poll), and how long a finished one is reused.
const VIDEO_PENDING = 'pending';
const VIDEO_PENDING_SECONDS = 15 * 60;
const VIDEO_REUSE_SECONDS = 10 * 60;
// Redis keys of an AI clip: its state (pending / the media id / a failure),
// the job a restarted process needs to finish it, and the lease of the
// process making it.
const VIDEO_KEY_PREFIX = 'ai-video:';
const VIDEO_JOB_PREFIX = 'ai-video-job:';
const VIDEO_LEASE_PREFIX = 'ai-video-lease:';
const VIDEO_OWNER_PREFIX = 'ai-video-owner:';
const VIDEO_FAILED = 'failed:';
const VIDEO_FAILED_SECONDS = 10 * 60;
const VIDEO_JOB_SECONDS = 30 * 60;
const VIDEO_LEASE_SECONDS = 60;
const VIDEO_LEASE_REFRESH_MS = 20_000;
const VIDEO_WAIT_POLL_MS = 2_000;
const VIDEO_FAILED_MESSAGE = 'Could not generate the video, please try again.';
const VIDEO_READY_SUBJECT = 'Your AI video is ready';
const VIDEO_READY_MESSAGE =
  'Your AI video is ready. You will find it in your media library.';
const VIDEO_FAILED_SUBJECT = 'Your AI video could not be made';

type VideoJob = {
  orgId: string;
  body: VideoDto;
  creditId: string;
  startedAt: number;
  taskId?: string;
  mediaId?: string;
};

@Injectable()
export class MediaService {
  private storage = UploadFactory.createStorage();

  constructor(
    private _mediaRepository: MediaRepository,
    private _openAi: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _videoManager: VideoManager,
    private _brandKitService: BrandKitService,
    private _studioAi: StudioAiService,
    private _postsRepository: PostsRepository,
    private _designRender: DesignRenderService,
    private _retouch: RetouchService,
    private _notificationService: NotificationService
  ) {}

  private readonly _videoLogger = new Logger('AiVideo');

  async deleteMedia(org: string, id: string) {
    const deleted = await this._mediaRepository.deleteMedia(org, id);
    if (!deleted) {
      throw new HttpException('Media not found', 404);
    }
    return deleted;
  }

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
  }

  deletedFromLibrary(org: string, ids: string[], paths: string[]) {
    return this._mediaRepository.deletedFromLibrary(org, ids, paths);
  }

  getMediaByIdOrg(org: string, id: string) {
    return this._mediaRepository.getMediaByIdOrg(org, id);
  }

  /**
   * Every raw AI image in the product goes through here — the composer's AI
   * Image, Studio's "AI Img" tab and the agent's generateImageTool — so this is
   * where the Brand Kit is applied. It used to be applied by the agent tool
   * alone, which is why an image asked for in the composer came back in
   * whatever palette the model felt like.
   *
   * The brand block is appended AFTER `generatePromptForPicture` expands the
   * prompt: the expander rewrites its input into a long scene description and
   * would paraphrase the hex colours away.
   */
  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean,
    // Which surface asked, so the usage log can tell the composer's images
    // apart from the agent's. Defaults to the /media routes.
    engine: AiUsageEvent['engine'] = 'media',
    // The shape the caller needs. Studio knows the format the design is in;
    // everything else keeps the square default.
    orientation: ImageOrientation = 'square'
  ) {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const brandKit = await this._brandKitService.getNormalized(org.id);
    const brand = buildBrandContext(brandKit, {
      palette: true,
      logoHint: true,
    });

    const generating = await this._subscriptionService.useCredit(
      org,
      'ai_images',
      async () => {
        if (generatePromptFirst) {
          prompt = await this._openAi.generatePromptForPicture(prompt, org.id);
        }
        const dataUrl = await this._openAi.generateImage(
          brand ? `${prompt}\n\n${brand}` : prompt,
          !!generatePromptFirst,
          orientation,
          { orgId: org.id, engine }
        );
        return dataUrl ? await this.storage.uploadSimple(dataUrl) : dataUrl;
      }
    );

    return generating;
  }

  /** `size` is for a caller that renders the design itself at a size of its
   *  own, so the background is made in that shape, not the format's. */
  async generatePostDesign(
    org: Organization,
    dto: GeneratePostDesignDto,
    size: DesignSize = platformDesignSize(dto.platform)
  ) {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      throw new HttpException(
        'No image generation credits remaining for this billing cycle',
        402
      );
    }

    const brandKit =
      dto.brandKit ?? (await this._brandKitService.getNormalized(org.id)) ?? undefined;

    const spec = await this._openAi.generatePostDesign(
      dto.prompt,
      dto.platform,
      brandKit,
      dto.language,
      org.id,
      dto.languageFallback
    );

    // The background is generated in the shape of the design. Until now every
    // format got a square, so an X post (16:9) lost a third of its background
    // to the crop. The orientation is part of the cache key for the same
    // reason — a square cached under this prompt is the wrong picture for a
    // landscape design.
    const orientation = orientationForSize(size.width, size.height);
    const cacheKey = `bg:${orientation}:${createHash('md5')
      .update(spec.imagePrompt.trim().toLowerCase())
      .digest('hex')}`;

    let backgroundUrl = await ioRedis.get(cacheKey);
    const cacheHit = !!backgroundUrl;

    if (!backgroundUrl) {
      backgroundUrl = await this._subscriptionService.useCredit(
        org,
        'ai_images',
        async () => {
          const dalleUrl = await this._openAi.generateImage(
            spec.imagePrompt,
            true,
            orientation,
            { orgId: org.id, engine: 'media' }
          );
          if (!dalleUrl) {
            throw new HttpException('The image generator returned nothing. Try again in a moment.', 502);
          }
          return await this.storage.uploadSimple(dalleUrl);
        }
      );

      await ioRedis.set(cacheKey, backgroundUrl, 'EX', POST_DESIGN_BG_CACHE_TTL);
    }

    return {
      ...spec,
      backgroundUrl,
      cacheHit,
      brandKit: brandKit ? { logoPath: brandKit.logoPath ?? null } : null,
    };
  }

  /**
   * One-shot "opportunity → branded draft": generate the on-brand design + a
   * caption, render the design to a flat PNG server-side, save it to the media
   * library and persist the design spec so it stays editable in Studio.
   *
   * The agent calls this via a single tool; the server orchestrates every step
   * and returns a finished draft, so there is no partial state to clean up.
   * Credit metering is inherited from `generatePostDesign` (one `ai_images`
   * credit for the background) — the caption + render add no extra charge.
   */
  async createBrandedDraft(
    org: Organization,
    dto: { prompt: string; platform: string; language?: string }
  ) {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const designPlatform =
      DESIGN_PLATFORM_BY_SOCIAL[dto.platform.toLowerCase()] ?? 'instagram-feed';

    // Pass one explicit language to BOTH the design and the caption so they
    // can't diverge (each generator otherwise detects language independently
    // and the brand-kit tone can tip the design to a different language).
    const draftSize = platformDesignSize(dto.platform);
    const spec = await this.generatePostDesign(
      org,
      {
        prompt: dto.prompt,
        platform: designPlatform,
        language: dto.language,
      } as GeneratePostDesignDto,
      draftSize
    );

    const brandKit = await this._brandKitService.getNormalized(org.id);

    const [copy, png] = await Promise.all([
      this._openAi.generateCaption(
        dto.prompt,
        dto.platform,
        brandKit ?? undefined,
        dto.language,
        org.id
      ),
      this._designRender.renderDesignToPng(spec, draftSize),
    ]);

    const uploaded = await this.storage.uploadSimple(
      'data:image/png;base64,' + png.toString('base64')
    );
    const media = await this.saveFile(
      org.id,
      uploaded.split('/').pop() as string,
      uploaded,
      undefined,
      // The design is composed over an AI-generated background, so the picture
      // that goes out is synthetic media even though we drew the text on it.
      true
    );

    // Persist the design spec so opening this media in Studio rebuilds an
    // editable canvas (edit-anywhere) rather than a flat raster.
    await this._mediaRepository.savePostDesignSpec(org.id, media.id, spec);

    return {
      copy,
      mediaId: media.id,
      path: media.path,
      headline: spec.headline,
    };
  }

  async generatePostCarousel(org: Organization, dto: GeneratePostCarouselDto) {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      throw new HttpException(
        'No image generation credits remaining for this billing cycle',
        402
      );
    }

    const brandKit =
      dto.brandKit ?? (await this._brandKitService.getNormalized(org.id)) ?? undefined;

    const carousel = await this._openAi.generatePostCarousel(
      dto.prompt,
      dto.platform,
      dto.slidesCount,
      brandKit,
      dto.language,
      org.id,
      dto.languageFallback
    );

    // Each slide gets a DISTINCT background that is a variation of one shared
    // theme (carousel.imagePrompt) — different angle/framing, same art
    // direction/palette/mood, so the carousel still reads as one cohesive post.
    // Cost scales with slide count (one DALL-E credit per unique background),
    // so we dedupe identical prompts (e.g. the normalize-duplicated last slide
    // or repeated variations) and generate the unique set in parallel.
    const slidePrompt = (variation?: string): string => {
      const v = (variation || '').trim();
      return v
        ? `${carousel.imagePrompt}\n\nThis slide's variation: ${v}. Keep the exact same art direction, color palette, lighting and mood as the base theme.`
        : carousel.imagePrompt;
    };

    const carouselSize = platformDesignSize(dto.platform);
    const carouselOrientation = orientationForSize(
      carouselSize.width,
      carouselSize.height
    );
    const slidesWithPrompts = carousel.slides.map(
      (s: { imageVariation?: string }) => {
        const prompt = slidePrompt(s.imageVariation);
        const cacheKey = `bg:${carouselOrientation}:${createHash('md5')
          .update(prompt.trim().toLowerCase())
          .digest('hex')}`;
        return { slide: s, prompt, cacheKey };
      }
    );

    const uniquePrompts = new Map<string, string>();
    for (const { cacheKey, prompt } of slidesWithPrompts) {
      if (!uniquePrompts.has(cacheKey)) uniquePrompts.set(cacheKey, prompt);
    }

    const bgByKey: Record<string, string | null> = {};
    const cacheHitByKey: Record<string, boolean> = {};
    await Promise.all(
      [...uniquePrompts.entries()].map(async ([cacheKey, prompt]) => {
        const cached = await ioRedis.get(cacheKey);
        if (cached) {
          bgByKey[cacheKey] = cached;
          cacheHitByKey[cacheKey] = true;
          return;
        }
        try {
          const url = await this._subscriptionService.useCredit(
            org,
            'ai_images',
            async () => {
              const dalleUrl = await this._openAi.generateImage(
                prompt,
                true,
                carouselOrientation,
                { orgId: org.id, engine: 'media' }
              );
              if (!dalleUrl) {
                throw new HttpException('The image generator returned nothing. Try again in a moment.', 502);
              }
              return await this.storage.uploadSimple(dalleUrl);
            }
          );
          bgByKey[cacheKey] = url;
          cacheHitByKey[cacheKey] = false;
          await ioRedis.set(cacheKey, url, 'EX', POST_DESIGN_BG_CACHE_TTL);
        } catch {
          // A single slide's background failing must not kill the whole
          // carousel — leave it null and fall back to a sibling below.
          bgByKey[cacheKey] = null;
          cacheHitByKey[cacheKey] = false;
        }
      })
    );

    const firstBg = Object.values(bgByKey).find((u): u is string => !!u) ?? null;
    if (!firstBg) {
      throw new HttpException('The image generator returned nothing. Try again in a moment.', 502);
    }

    return {
      slides: slidesWithPrompts.map(
        ({ slide, cacheKey }: { slide: any; cacheKey: string }) => ({
        ...slide,
        imagePrompt: carousel.imagePrompt,
        colors: carousel.colors,
        backgroundUrl: bgByKey[cacheKey] ?? firstBg,
        cacheHit: cacheHitByKey[cacheKey] ?? false,
        brandKit: brandKit ? { logoPath: brandKit.logoPath ?? null } : null,
      })),
    };
  }

  async saveCanvasJson(org: string, id: string, canvasJson: string) {
    // The controller DTO bounds the size; here we confirm it's actually a
    // Fabric canvas (top-level object with an `objects` array) before storing
    // it, so a garbage string can't be persisted and then crash the editor on
    // load.
    let parsed: unknown;
    try {
      parsed = JSON.parse(canvasJson);
    } catch {
      throw new HttpException('Invalid canvas JSON', 400);
    }
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray((parsed as { objects?: unknown }).objects)
    ) {
      throw new HttpException('Invalid canvas JSON', 400);
    }

    return this._mediaRepository.saveCanvasJson(org, id, canvasJson);
  }

  async setTemplateFlag(org: string, id: string, isTemplate: boolean) {
    return this._mediaRepository.setTemplateFlag(org, id, isTemplate);
  }

  async getTemplates(org: string) {
    return this._mediaRepository.getTemplates(org);
  }

  getMediaForEdit(org: string, id: string) {
    return this._mediaRepository.getMediaByIdForOrg(org, id);
  }

  // Pixabay CDN is host-pinned by the controller regex (not SSRF), but the
  // download was unbounded: no timeout, no size cap → a slow/huge asset could
  // pin a worker and buffer freely into the 3.7GiB box. Bound both.
  private async fetchPixabayAsset(url: string, maxBytes: number) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      return { res, buffer: null as Buffer | null };
    }
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared && declared > maxBytes) {
      throw new HttpException('Pixabay asset exceeds size limit', 502);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new HttpException('Pixabay asset exceeds size limit', 502);
    }
    return { res, buffer };
  }

  async importPixabayVideo(org: string, sourceUrl: string, sourceId?: number) {
    const { res, buffer } = await this.fetchPixabayAsset(
      sourceUrl,
      100 * 1024 * 1024
    );
    if (!res.ok || !buffer) {
      throw new HttpException(`Failed to fetch Pixabay video (${res.status})`, 502);
    }
    const fakeFile = {
      buffer,
      originalname: `pixabay-${sourceId ?? Date.now()}.mp4`,
      mimetype: 'video/mp4',
      size: buffer.length,
    } as unknown as Express.Multer.File;
    await this.assertStorage(org, buffer.length);
    const uploaded = await this.storage.uploadFile(fakeFile);
    return this.saveFile(
      org,
      uploaded.originalname,
      uploaded.path,
      `pixabay-${sourceId ?? 'unknown'}`,
      false,
      buffer.length
    );
  }

  async importPixabayImage(org: string, sourceUrl: string, sourceId?: number) {
    // Basic API keys only expose webformatURL (640px). Pixabay documents that
    // the _640 suffix can be swapped for _1280 — try the bigger variant first
    // (1080px canvases need it), fall back to the original URL.
    const hiRes = sourceUrl.replace('_640.', '_1280.');
    const cap = 30 * 1024 * 1024;
    let attempt =
      hiRes !== sourceUrl ? await this.fetchPixabayAsset(hiRes, cap) : null;
    if (!attempt?.res.ok || !attempt.buffer) {
      attempt = await this.fetchPixabayAsset(sourceUrl, cap);
    }
    if (!attempt.res.ok || !attempt.buffer) {
      throw new HttpException(
        `Failed to fetch Pixabay image (${attempt.res.status})`,
        502
      );
    }
    const buffer = attempt.buffer;
    const isPng = /\.png(\?|$)/.test(sourceUrl);
    const fakeFile = {
      buffer,
      originalname: `pixabay-${sourceId ?? Date.now()}.${isPng ? 'png' : 'jpg'}`,
      mimetype: isPng ? 'image/png' : 'image/jpeg',
      size: buffer.length,
    } as unknown as Express.Multer.File;
    await this.assertStorage(org, buffer.length);
    const uploaded = await this.storage.uploadFile(fakeFile);
    return this.saveFile(
      org,
      uploaded.originalname,
      uploaded.path,
      `pixabay-${sourceId ?? 'unknown'}`,
      false,
      buffer.length
    );
  }

  // Stock files (Pexels, Unsplash): hosts checked by the controller; the type
  // is read from the bytes, not trusted from the URL.
  async importStockAsset(
    org: string,
    sourceUrl: string,
    kind: 'image' | 'video',
    name: string
  ) {
    const { res, buffer } = await this.fetchPixabayAsset(
      sourceUrl,
      (kind === 'video' ? 100 : 30) * 1024 * 1024
    );
    if (!res.ok || !buffer) {
      throw new HttpException(`Failed to fetch the stock ${kind} (${res.status})`, 502);
    }
    const detected = await fileTypeFromBuffer(buffer);
    const allowed =
      kind === 'video'
        ? detected?.mime === 'video/mp4'
        : ['image/jpeg', 'image/png', 'image/webp'].includes(detected?.mime || '');
    if (!detected || !allowed) {
      throw new HttpException(`That file is not a supported ${kind}`, 422);
    }
    await this.assertStorage(org, buffer.length);
    const uploaded = await this.storage.uploadFile({
      buffer,
      originalname: `${name}.${detected.ext}`,
      mimetype: detected.mime,
      size: buffer.length,
    } as unknown as Express.Multer.File);
    return this.saveFile(org, uploaded.originalname, uploaded.path, name, false, buffer.length);
  }

  // Every file that enters the library comes through here, so this is where
  // its size is recorded for the plan's media storage. A caller that holds
  // the bytes passes their length; otherwise the storage is asked.
  async saveFile(
    org: string,
    fileName: string,
    filePath: string,
    originalName?: string,
    aiGenerated = false,
    fileSize?: number
  ) {
    const size = await sizeToRecord(fileSize, this.storage, filePath);
    const media = await this._mediaRepository.saveFile(
      org,
      fileName,
      filePath,
      originalName,
      aiGenerated,
      size
    );
    if (media.type === 'video') {
      // Not awaited: the upload answers at once and the frame follows in a
      // second or two. If this process dies first, the daily housekeeping
      // run fills it.
      void this.fillPoster(media.id, media.path);
    }
    return media;
  }

  // A still frame for the video's tile in lists.
  async fillPoster(id: string, path: string) {
    try {
      const poster = await posterFor(path, this.storage);
      if (poster !== null) {
        await this._mediaRepository.setPoster(id, poster);
      }
      return poster;
    } catch (err) {
      Logger.warn(`poster for media ${id} failed: ${(err as Error)?.message}`);
      return null;
    }
  }

  // Bytes of a stored file (0 when the storage cannot tell).
  storedSize(filePath: string): Promise<number> {
    return sizeToRecord(undefined, this.storage, filePath);
  }

  // The plan's media storage: bytes the library holds
  // and the plan's limit, null while billing is off (self-hosted, local).
  async storageQuota(orgId: string): Promise<{ used: number; limit: number | null }> {
    const used = await this._mediaRepository.storageUsed(orgId);
    if (!process.env.STRIPE_PUBLISHABLE_KEY) {
      return { used, limit: null };
    }
    const [subscription, trialing] = await Promise.all([
      this._subscriptionService.getSubscriptionByOrganizationId(orgId),
      this._subscriptionService.isTrailing(orgId),
    ]);
    return { used, limit: storageLimit(subscription?.subscriptionTier, trialing) };
  }

  // Refuses a new file that would not fit (media.storage.ts).
  async assertStorage(orgId: string, incomingBytes: number) {
    const { used, limit } = await this.storageQuota(orgId);
    const refusal = storageFullError(used, limit, incomingBytes);
    if (refusal) {
      throw refusal;
    }
  }

  // One-off: sizes for rows saved before the size was recorded. Read from
  // the storage; a file that is gone stays at 0. Dry run unless `apply`.
  async backfillFileSize(apply: boolean) {
    let afterId: string | undefined;
    let checked = 0;
    let found = 0;
    let bytes = 0;
    for (;;) {
      const rows = await this._mediaRepository.mediaWithoutSize(200, afterId);
      if (!rows.length) break;
      for (const row of rows) {
        checked++;
        const size = await sizeToRecord(undefined, this.storage, row.path);
        if (size > 0) {
          found++;
          bytes += size;
          if (apply) await this._mediaRepository.setFileSize(row.id, size);
        }
      }
      afterId = rows[rows.length - 1].id;
    }
    return { checked, found, bytes, applied: apply };
  }

  backfillMediaType(apply: boolean) {
    return this._mediaRepository.backfillMediaType(apply);
  }

  getMedia(org: string, page: number, search?: string, type?: MediaType) {
    return this._mediaRepository.getMedia(org, page, search, type);
  }

  async saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    const saved = await this._mediaRepository.saveMediaInformation(org, data);
    if (!saved) {
      throw new HttpException('Media not found', 404);
    }
    return saved;
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      // A name that is not on the list is a bad request, not a server fault.
      // Thrown as a plain Error it surfaced as a 500 and filled Sentry.
      throw new HttpException(`Video type ${type} not found`, 404);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  /**
   * Makes the clip and answers only when it is in the library (or failed).
   * Kept for the public API's original endpoint; everything in the app uses
   * startVideo. Past the load balancer's three minutes the caller gets a 504,
   * but the clip is still made, saved and announced.
   */
  async generateVideo(org: Organization, body: VideoDto) {
    const started = await this.startVideo(org, body);
    if (started.status === 'done') {
      return started.media;
    }
    const key = this.videoKey(org.id, body);
    for (;;) {
      await timer(VIDEO_WAIT_POLL_MS);
      const value = await ioRedis.get(key);
      if (value === VIDEO_PENDING) {
        continue;
      }
      const failure = this.videoFailure(value);
      if (failure) {
        throw new HttpException(failure.message, failure.status);
      }
      const media = await this.finishedVideo(org.id, key);
      if (media) {
        return media;
      }
      throw new HttpException(VIDEO_FAILED_MESSAGE, 500);
    }
  }

  /**
   * Starts a clip and answers at once. A clip takes minutes: longer than the
   * load balancer's three, the assistant's two-minute run and any API
   * client's patience. The server makes
   * it, saves it to the library and tells the organisation; callers ask
   * videoResult where it stands.
   *
   * One clip, one payment: a double click, a retry or the assistant calling
   * twice joins the clip already being made, and a finished one is answered
   * from the library for VIDEO_REUSE_SECONDS - even with no credits left, it
   * is paid for. The credit is reserved here (so "no credits" is answered at
   * once) and handed back when the clip fails.
   */
  async startVideo(
    org: Organization,
    body: VideoDto
  ): Promise<
    | { status: 'pending'; id: string }
    | { status: 'done'; id: string; media: Awaited<ReturnType<MediaService['getMediaByIdOrg']>> }
  > {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const key = this.videoKey(org.id, body);
    const id = this.videoJobId(key);
    const reused = await this.finishedVideo(org.id, key);
    if (reused) {
      return { status: 'done', id, media: reused };
    }
    const totalCredits = await this._subscriptionService.checkCredits(
      org,
      'ai_videos'
    );

    // Align with the image paths: with billing off (no publishable key) the
    // credit ledger is advisory — an org without a subscription row would
    // otherwise resolve FREE = 0 credits and video would be blocked for all.
    if (process.env.STRIPE_PUBLISHABLE_KEY && totalCredits.credits <= 0) {
      throw new SubscriptionException({
        action: AuthorizationActions.Create,
        section: Sections.VIDEOS_PER_MONTH,
      });
    }

    const video = this._videoManager.getVideoByName(body.type);
    if (!video) {
      throw new HttpException(`Video type ${body.type} not found`, 404);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    await video.instance.processAndValidate(body.customParams);

    if (!(await this.claimVideoKey(key))) {
      const finished = await this.finishedVideo(org.id, key);
      if (finished) {
        return { status: 'done', id, media: finished };
      }
      // Being made: this request is that clip.
      return { status: 'pending', id };
    }

    // Held from the start, so the minute sweep never takes a clip that is
    // still being started here for one left by a stopped process.
    const lease = `${VIDEO_LEASE_PREFIX}${id}`;
    await ioRedis.set(lease, '1', 'EX', VIDEO_LEASE_SECONDS);
    await ioRedis.set(this.videoOwnerPath(key), org.id, 'EX', VIDEO_JOB_SECONDS);

    // The credit is reserved inside useCredit before the clip is started;
    // a refusal there (402, the plan's limit) must reach this caller.
    let reserved!: () => void;
    const reservation = new Promise<void>((resolve) => (reserved = resolve));
    const run = this._subscriptionService.useCredit(
      org,
      'ai_videos',
      async (credit) => {
        await this.saveVideoJob(key, {
          orgId: org.id,
          body,
          creditId: credit.id,
          startedAt: Date.now(),
        });
        reserved();
        return this.makeVideo(org.id, key, video.instance, body);
      }
    );
    try {
      await Promise.race([reservation, run]);
    } catch (err) {
      await ioRedis.del(key, lease, this.videoOwnerPath(key)).catch((): undefined => undefined);
      throw err;
    }
    run.then(
      (media) => this.videoMade(org.id, key, body, video.instance, media),
      // useCredit has handed the credit back by now.
      (err) => this.videoFailed(org.id, key, err)
    );
    return { status: 'pending', id };
  }

  /** One key per organisation and request: the same prompt, shape and
   *  pictures are the same clip. */
  private videoKey(orgId: string, body: VideoDto) {
    return `${VIDEO_KEY_PREFIX}${createHash('sha256')
      .update(
        JSON.stringify([orgId, body.type, body.output, body.customParams])
      )
      .digest('hex')}`;
  }

  private videoJobId(key: string) {
    return key.slice(VIDEO_KEY_PREFIX.length);
  }

  /** Marks the clip as being made, unless it already is (or is made). A
   *  failure left by an earlier try does not block a new one. */
  private async claimVideoKey(key: string) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (
        (await ioRedis.set(key, VIDEO_PENDING, 'EX', VIDEO_PENDING_SECONDS, 'NX')) ===
        'OK'
      ) {
        return true;
      }
      const value = await ioRedis.get(key);
      if (!this.videoFailure(value)) {
        return false;
      }
      await ioRedis
        .eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
          1,
          key,
          value as string
        )
        .catch((): undefined => undefined);
    }
    return false;
  }

  /** Makes the clip and keeps it in the library. While it runs this process
   *  holds a lease on it; a process that dies leaves the job and its kie.ai
   *  task id behind for resumeVideoJobs. */
  private async makeVideo(
    orgId: string,
    key: string,
    instance: VideoAbstract<any>,
    body: VideoDto,
    taskId?: string
  ) {
    const lease = `${VIDEO_LEASE_PREFIX}${this.videoJobId(key)}`;
    await ioRedis.set(lease, '1', 'EX', VIDEO_LEASE_SECONDS);
    const keepAlive = setInterval(() => {
      ioRedis.set(lease, '1', 'EX', VIDEO_LEASE_SECONDS).catch((): undefined => undefined);
      ioRedis.expire(key, VIDEO_PENDING_SECONDS).catch((): undefined => undefined);
    }, VIDEO_LEASE_REFRESH_MS);
    keepAlive.unref?.();
    try {
      let url: string;
      if (instance.start && instance.finish) {
        if (!taskId) {
          taskId = await instance.start(body.output, body.customParams);
          await this.updateVideoJob(key, { taskId });
        }
        url = await instance.finish(taskId);
      } else {
        url = await instance.process(body.output, body.customParams);
      }
      const file = await this.storage.uploadSimple(url);
      const media = await this.saveFile(
        orgId,
        file.split('/').pop(),
        file,
        undefined,
        true
      );
      // Kept with the job: a process stopped from here on is finished
      // without saving the clip a second time.
      await this.updateVideoJob(key, { mediaId: media.id });
      return media;
    } finally {
      clearInterval(keepAlive);
      // The lease stays (it expires on its own) until videoMade or
      // videoFailed has removed the job: released here, the minute sweep
      // could take a job that is finished and make its clip again.
    }
  }

  /** The job is done with: its record first, then the lease. */
  private async closeVideoJob(key: string) {
    await ioRedis.del(this.videoJobPath(key));
    await ioRedis
      .del(`${VIDEO_LEASE_PREFIX}${this.videoJobId(key)}`)
      .catch((): undefined => undefined);
  }

  private async videoMade(
    orgId: string,
    key: string,
    body: VideoDto,
    instance: VideoAbstract<any>,
    media: { id: string }
  ) {
    try {
      // What the clip cost us, for the margin guard (images and text are
      // logged where they are made; a clip only once it is in the library).
      recordAiUsage({
        organizationId: orgId,
        engine: 'video',
        model: instance.usageModel || body.type,
        unit: 'videos',
        inputAmount: 1,
      });
      await ioRedis.set(key, media.id, 'EX', VIDEO_REUSE_SECONDS);
      await ioRedis.set(this.videoOwnerPath(key), orgId, 'EX', VIDEO_REUSE_SECONDS);
      await this.closeVideoJob(key);
      // The window that asked may be long closed.
      await this._notificationService.inAppNotification(
        orgId,
        VIDEO_READY_SUBJECT,
        VIDEO_READY_MESSAGE,
        false,
        false,
        'success',
        'media'
      );
    } catch (err) {
      this._videoLogger.error(
        `AI video ${this.videoJobId(key)} saved as ${media.id}, but finishing it failed: ${(err as Error)?.message}`
      );
    }
  }

  private async videoFailed(orgId: string, key: string, err: unknown) {
    const status = err instanceof HttpException ? err.getStatus() : 500;
    // Our own words reach the customer (a refused prompt, the model being
    // down); anything else stays in the log.
    const message =
      err instanceof HttpException && status !== 500
        ? err.message
        : VIDEO_FAILED_MESSAGE;
    this._videoLogger.warn(
      `AI video ${this.videoJobId(key)} failed: ${(err as Error)?.message}`
    );
    try {
      await ioRedis.set(
        key,
        `${VIDEO_FAILED}${status}:${message}`,
        'EX',
        VIDEO_FAILED_SECONDS
      );
      await ioRedis.set(this.videoOwnerPath(key), orgId, 'EX', VIDEO_FAILED_SECONDS);
      await this.closeVideoJob(key);
      await this._notificationService.inAppNotification(
        orgId,
        VIDEO_FAILED_SUBJECT,
        message,
        false,
        false,
        'fail',
        'media'
      );
    } catch (e) {
      this._videoLogger.error(
        `AI video ${this.videoJobId(key)}: recording the failure failed: ${(e as Error)?.message}`
      );
    }
  }

  private videoFailure(value: string | null) {
    if (!value?.startsWith(VIDEO_FAILED)) {
      return null;
    }
    const rest = value.slice(VIDEO_FAILED.length);
    const colon = rest.indexOf(':');
    return {
      status: Number(rest.slice(0, colon)) || 500,
      message: rest.slice(colon + 1) || VIDEO_FAILED_MESSAGE,
    };
  }

  private videoJobPath(key: string) {
    return `${VIDEO_JOB_PREFIX}${this.videoJobId(key)}`;
  }

  /** Which organisation a clip id belongs to, for lookups by id. */
  private videoOwnerPath(key: string) {
    return `${VIDEO_OWNER_PREFIX}${this.videoJobId(key)}`;
  }

  private async saveVideoJob(key: string, job: VideoJob) {
    await ioRedis.set(
      this.videoJobPath(key),
      JSON.stringify(job),
      'EX',
      VIDEO_JOB_SECONDS
    );
  }

  private async updateVideoJob(key: string, change: Partial<VideoJob>) {
    const raw = await ioRedis.get(this.videoJobPath(key));
    if (!raw) {
      return;
    }
    await this.saveVideoJob(key, { ...(JSON.parse(raw) as VideoJob), ...change });
  }

  /**
   * Collects clips whose process is gone (a deploy, a restart): the job
   * outlives it in Redis with the kie.ai task id, and the first process to
   * take the lease finishes it - the customer paid one credit and gets the
   * clip. A job that never reached kie.ai is failed and its credit handed
   * back. Called every minute by each backend process.
   */
  async resumeVideoJobs() {
    let cursor = '0';
    do {
      const [next, paths] = await ioRedis.scan(
        cursor,
        'MATCH',
        `${VIDEO_JOB_PREFIX}*`,
        'COUNT',
        100
      );
      cursor = next;
      for (const path of paths) {
        const id = path.slice(VIDEO_JOB_PREFIX.length);
        const lease = `${VIDEO_LEASE_PREFIX}${id}`;
        if (
          (await ioRedis.set(lease, '1', 'EX', VIDEO_LEASE_SECONDS, 'NX')) !==
          'OK'
        ) {
          continue;
        }
        const raw = await ioRedis.get(path);
        if (!raw) {
          await ioRedis.del(lease);
          continue;
        }
        void this.resumeVideoJob(`${VIDEO_KEY_PREFIX}${id}`, JSON.parse(raw));
      }
    } while (cursor !== '0');
  }

  private async resumeVideoJob(key: string, job: VideoJob) {
    const video = this._videoManager.getVideoByName(job.body.type);
    const resumable = !!(
      job.mediaId ||
      (video?.instance.start && video.instance.finish && job.taskId)
    );
    this._videoLogger.log(
      `AI video ${this.videoJobId(key)}: ${resumable ? 'resuming' : 'failing'} a job left by a stopped process`
    );
    try {
      if (!resumable) {
        throw new HttpException(VIDEO_FAILED_MESSAGE, 500);
      }
      await ioRedis.set(key, VIDEO_PENDING, 'EX', VIDEO_PENDING_SECONDS);
      // Saved before its process stopped: only the finishing is left.
      const media = job.mediaId
        ? { id: job.mediaId }
        : await this.makeVideo(
            job.orgId,
            key,
            video!.instance,
            job.body,
            job.taskId
          );
      await this.videoMade(job.orgId, key, job.body, video!.instance, media);
    } catch (err) {
      await this._subscriptionService
        .refundCredit(job.creditId)
        .catch((): undefined => undefined);
      await this.videoFailed(job.orgId, key, err);
    }
  }

  /**
   * Where the clip this exact request asked for stands: being made, made (the
   * library file), failed (with the reason, the credit handed back), or
   * never asked for. It never makes a clip and never spends a credit.
   */
  async videoResult(org: Organization, body: VideoDto) {
    return this.videoResultByKey(org.id, this.videoKey(org.id, body));
  }

  /** The same, by the id startVideo answered with (the public API). Another
   *  organisation's id, like an unknown one, is a 404: it must not learn the
   *  clip exists, nor how it ended. */
  async videoResultById(org: Organization, id: string) {
    const key = `${VIDEO_KEY_PREFIX}${id}`;
    if (
      !/^[0-9a-f]{64}$/.test(id) ||
      (await ioRedis.get(this.videoOwnerPath(key))) !== org.id
    ) {
      throw new HttpException('Video not found', 404);
    }
    const result = await this.videoResultByKey(org.id, key);
    if (result.status === 'none') {
      throw new HttpException('Video not found', 404);
    }
    return result;
  }

  private async videoResultByKey(
    orgId: string,
    key: string
  ): Promise<
    | { status: 'pending' }
    | { status: 'done'; media: Awaited<ReturnType<MediaService['getMediaByIdOrg']>> }
    | { status: 'failed'; message: string }
    | { status: 'none' }
  > {
    // The id is the hash of the organisation and the request: another
    // organisation's id names nothing here.
    const value = await ioRedis.get(key);
    if (value === VIDEO_PENDING) {
      const job = await ioRedis.get(this.videoJobPath(key));
      if (!job || (JSON.parse(job) as VideoJob).orgId === orgId) {
        return { status: 'pending' };
      }
      return { status: 'none' };
    }
    const failure = this.videoFailure(value);
    if (failure) {
      return { status: 'failed', message: failure.message };
    }
    const media = await this.finishedVideo(orgId, key);
    return media ? { status: 'done', media } : { status: 'none' };
  }

  private async finishedVideo(org: string, key: string) {
    const id = await ioRedis.get(key);
    if (!id || id === VIDEO_PENDING || this.videoFailure(id)) {
      return null;
    }
    const media = await this.getMediaByIdOrg(org, id);
    if (media && !media.deletedAt) {
      return media;
    }
    if (!media && (await this.getMediaById(id))) {
      // Another organisation's clip (an id passed to the public API): not
      // ours to answer, and not ours to forget.
      return null;
    }
    // Deleted from the library: forget it, so the same request can make the
    // clip again instead of reading as "already being made". Only
    // while the key still names that clip — a new run may own it by now.
    await ioRedis
      .eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",
        1,
        key,
        id
      )
      .catch((): undefined => undefined);
    return null;
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new HttpException(
        `Video with identifier ${identifier} not found`,
        404
      );
    }

    // Resolve the name against the @ExposeVideoFunction allowlist instead of
    // indexing the instance with raw user input. Calling through the instance
    // also keeps `this` bound (the old unbound call lost it).
    const safeName = this._videoManager
      .listExposedVideoFunctions(video.instance)
      .find((name) => name === functionName);

    if (!safeName) {
      throw new HttpException(
        `Function ${functionName} not found on video instance`,
        400
      );
    }

    // @ts-ignore
    return video.instance[safeName](body);
  }

  // Refine/brand-voice/ai-edit are text (and vision) calls, not image
  // generation. They used to spend an `ai_images` credit, which meant a user
  // out of image credits could not fix the tone of a caption — and it was
  // inconsistent with every other text AI in the product, which is unmetered.
  // They stay unmetered for now and keep their 30-per-5-minutes throttle;
  // token usage is still recorded to AiUsage (observational, not billing) so a
  // real `ai_text` bucket can be priced once there is post-launch traffic.
  /**
   * Photo retouch: a new library file made from an
   * untouched source. The model decides, sharp applies; when AI is down the
   * heuristic decides, so the photo still comes back. Unmetered like Refine
   * (throttled at the route, tokens recorded to AiUsage); never AI-generated
   * in the TikTok/YouTube sense, the pixels are the customer's photo.
   */
  async retouch(org: Organization, id: string, level: RetouchLevel) {
    // A full library stops here, before any credit or model time is spent
    // on a file that could not be kept.
    await this.assertStorage(org.id, 0);
    const media = await this.getMediaByIdOrg(org.id, id);
    if (!media?.path || media.deletedAt) {
      throw new HttpException('Media not found', 404);
    }
    if (media.type === 'video') {
      throw new HttpException('Only photos can be retouched', 422);
    }
    // A retouched file opened again is redone from its untouched source (a
    // black and white result retouched at Strong gets its colours back,
    // corrections and JPEG loss never pile up), reusing the decision made
    // for that source. When the source is gone the file itself is the
    // source and the model decides afresh.
    const original =
      media.retouchSourceId &&
      (await this.getMediaByIdOrg(org.id, media.retouchSourceId));
    const from = original && original.path && !original.deletedAt ? original : media;
    const sourceId = from.id;
    // Phase times to the log (no names, no paths): the first production run
    // took 57 s on a 12-megapixel photo and nothing said where.
    const started = Date.now();
    const marks: string[] = [];
    const mark = (label: string, since: number) =>
      marks.push(`${label}=${Date.now() - since}ms`);
    let at = Date.now();
    const source = await this._retouch.loadSource(from.path);
    mark('load', at);
    const previous =
      from.id !== media.id && media.retouchSpec && media.retouchLevel
        ? RetouchSpecSchema.safeParse(media.retouchSpec)
        : null;
    const preset: RetouchSpec | undefined =
      previous && previous.success ? previous.data : undefined;
    at = Date.now();
    const result = await this._retouch.retouchBytes(
      source,
      level,
      org.id,
      preset,
      from.originalName || from.name
    );
    mark(preset ? 'apply' : 'decide+apply', at);
    at = Date.now();
    const uploaded = await this.storage.uploadSimple(
      `data:image/jpeg;base64,${result.buffer.toString('base64')}`
    );
    mark('upload', at);
    const fileName = uploaded.split('/').pop() || 'retouched.jpg';
    const base = (from.originalName || from.name || 'photo')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/ \(retouched.*\)$/i, '');
    const saved = await this.saveFile(
      org.id,
      fileName,
      uploaded,
      `${base} (retouched, ${level === 'bw' ? 'black and white' : level}).jpg`,
      // the pixels are still the source's: a photo stays a photo, an image a
      // model made stays marked for TikTok and YouTube
      from.aiGenerated,
      result.buffer.length
    );
    await this._mediaRepository.attachRetouch(org.id, saved.id, {
      spec: result.spec,
      sourceId,
      level,
    });
    Logger.log(
      `retouch ${level} ${result.width}x${result.height} from ${source.length} bytes: ${marks.join(' ')} total=${Date.now() - started}ms${result.fallback ? ' fallback' : ''}`,
      'Retouch'
    );
    return {
      id: saved.id,
      path: saved.path,
      originalName: saved.originalName,
      sourceId,
      level,
      summary: result.spec.summary,
      fallback: result.fallback,
      width: result.width,
      height: result.height,
    };
  }

  /**
   * Studio's Remove background: the picture on the canvas in, a transparent
   * PNG out, kept in the library like a retouched copy so the design and its
   * drafts point at a file rather than carry megabytes of data: URL.
   */
  async removeBackground(org: Organization, file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new HttpException('No image was sent', 400);
    }
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !BACKGROUND_REMOVAL_TYPES.has(detected.mime)) {
      throw new HttpException(UNREADABLE, 422);
    }
    if (file.size > BACKGROUND_REMOVAL_MAX_BYTES) {
      throw new HttpException('This image is too large. Use one under 25 MB.', 413);
    }
    // A full library stops here, before kie.ai is paid for a file that could
    // not be kept; the cut-out is checked again at its own size before it is
    // kept.
    await this.assertStorage(org.id, 0);
    const started = Date.now();
    const input = await prepareInput(file.buffer);
    // kie.ai reads the picture from a URL: it goes to our storage first.
    const inputUrl = await this.storage.uploadSimple(
      `data:${input[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${input.toString('base64')}`
    );
    const resultUrl = await removeBackground(inputUrl, org.id).finally(() =>
      // The input was only for kie.ai to read.
      this.storage.removeFile(inputUrl).catch((): undefined => undefined)
    );
    const uploaded = await this.storage.uploadSimple(resultUrl);
    const size = await this.storedSize(uploaded);
    try {
      await this.assertStorage(org.id, size);
    } catch (err) {
      // Over the plan's storage with the cut-out: keep nothing.
      await this.storage.removeFile(uploaded).catch((): undefined => undefined);
      throw err;
    }
    const ext = (uploaded.split('.').pop() || 'png').toLowerCase();
    const base = (file.originalname || 'image')
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/ \(background removed\)$/i, '');
    const saved = await this.saveFile(
      org.id,
      uploaded.split('/').pop() || `background-removed.${ext}`,
      uploaded,
      `${base} (background removed).${ext}`,
      false,
      size
    );
    Logger.log(
      `background removed ${file.size} -> ${size} bytes in ${Date.now() - started}ms`,
      'BackgroundRemoval'
    );
    return { id: saved.id, path: saved.path, originalName: saved.originalName };
  }

  async refineDesign(org: Organization, body: RefineDesignDto) {
    const spec = body.spec as StudioSpec;

    const result = await this._studioAi.refineSpec(
      spec,
      body.instruction,
      body.screenshot,
      org.id
    );
    return {
      patch: result.patch,
      nextSpec: result.nextSpec,
      explanation: result.explanation,
    };
  }

  async checkBrandVoice(
    org: Organization,
    body: BrandVoiceCheckDto
  ): Promise<BrandVoiceResult> {
    const brandKit = await this._brandKitService.getNormalized(org.id);
    const recentPosts = await this.getRecentPostBodies(org.id);

    return this._studioAi.checkBrandVoice(
      {
        caption: body.caption,
        recentPosts,
        brand: brandKit
          ? {
              primary: brandKit.colors.primary,
              secondary: brandKit.colors.secondary,
              text: brandKit.colors.text,
              fontFamily: brandKit.font,
              tone: brandKit.tone,
            }
          : undefined,
      },
      org.id
    );
  }

  // Inline composer AI: rewrite/shorten/expand/adapt/fix-tone the caption in the
  // user's brand voice.
  async generateAltText(
    org: Organization,
    id: string
  ): Promise<{ alt: string }> {
    // by id and org, so the URL handed to the model is always one of ours
    const media = await this.getMediaByIdOrg(org.id, id);
    if (!media?.path) {
      throw new HttpException('Media not found', 404);
    }

    return this._studioAi.describeImageForAlt(media.path, org.id);
  }

  async suggestHashtags(
    org: Organization,
    body: SuggestHashtagsDto
  ): Promise<{ hashtags: string[] }> {
    const brandKit = await this._brandKitService.getNormalized(org.id);

    return this._studioAi.suggestHashtags(
      {
        text: body.text,
        platform: body.platform,
        tone: brandKit?.tone,
      },
      org.id
    );
  }

  async aiEditText(
    org: Organization,
    body: AiEditTextDto
  ): Promise<{ text: string }> {
    const brandKit = await this._brandKitService.getNormalized(org.id);

    return this._studioAi.editText(
      {
        text: body.text,
        action: body.action,
        platform: body.platform,
        language: body.language,
        tone: brandKit?.tone,
      },
      org.id
    );
  }

  /**
   * Embeddings cost ~$0.000003 per query — skip useCredit. Templates are
   * embedded once and cached in Redis so the cost per query is just one
   * query embedding.
   */
  async searchTemplates(
    body: TemplateSearchDto,
    orgId?: string
  ): Promise<{ id: string; score: number }[] | { needTemplates: true }> {
    // The key has to cover the TEXTS, not just the ids: the client sends both,
    // and the ids alone are identical across languages and across template
    // edits. Keyed by id only, whoever searched first — any org, in whichever
    // language their UI happened to be — defined the embeddings everyone else
    // matched against for the next 30 days.
    const corpusHash = body.templates?.length
      ? createHash('sha256').update(templateCorpus(body.templates)).digest('hex')
      : body.corpusHash;
    if (!corpusHash) return [];

    const cacheKey = `studio:tpl-embeds:${corpusHash}`;

    let embeddings: { id: string; embedding: number[] }[] | null = null;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      try {
        embeddings = JSON.parse(cached);
      } catch {
        embeddings = null;
      }
    }

    if (!embeddings) {
      // Nothing cached and no texts to embed: ask for them rather than
      // returning an empty result, which would read as "no template matches".
      if (!body.templates?.length) return { needTemplates: true };
      const texts = body.templates.map((t) => t.text);
      const vectors = await this._studioAi.embedBatch(texts, orgId);
      embeddings = body.templates.map((t, i) => ({ id: t.id, embedding: vectors[i] }));
      await ioRedis.set(
        cacheKey,
        JSON.stringify(embeddings),
        'EX',
        TEMPLATE_EMBED_CACHE_TTL
      );
    }

    const queryEmbedding = await this._studioAi.embedText(body.query, orgId);
    return rankBySimilarity(queryEmbedding, embeddings);
  }

  saveDesignSpec(org: string, mediaId: string, spec: StudioSpec) {
    // Same light guard refineSpec uses: a StudioSpec must carry a bounded
    // `layers` array. The controller DTO only proves it's an object.
    const layers = (spec as { layers?: unknown })?.layers;
    if (!Array.isArray(layers) || layers.length > 200) {
      throw new HttpException('Invalid design spec', 400);
    }
    return this._mediaRepository.saveDesignSpec(org, mediaId, spec);
  }

  private getRecentPostBodies(orgId: string): Promise<string[]> {
    return this._postsRepository.getRecentPostBodies(orgId, RECENT_POSTS_FOR_VOICE);
  }
}
