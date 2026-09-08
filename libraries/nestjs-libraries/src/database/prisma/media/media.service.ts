import { HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { Organization } from '@prisma/client';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  GeneratePostDesignDto,
  PostDesignPlatform,
} from '@gitroom/nestjs-libraries/dtos/media/generate.post.design.dto';
import { GeneratePostCarouselDto } from '@gitroom/nestjs-libraries/dtos/media/generate.post.carousel.dto';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
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
import { platformDesignSize } from '@gitroom/nestjs-libraries/studio/post-design-spec';
import {
  BrandVoiceCheckDto,
  AiEditTextDto,
  SuggestHashtagsDto,
  RefineDesignDto,
  TemplateSearchDto,
} from '@gitroom/nestjs-libraries/studio/studio.dto';
import {
  AuthorizationActions,
  Sections,
  SubscriptionException,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const POST_DESIGN_BG_CACHE_TTL = 60 * 60 * 24 * 7; // 7 days

// Map a social channel to the design format that reads best on it. The design
// generator only uses this as descriptive context; the actual canvas size is
// resolved separately from `platformDesignSize`.
const DESIGN_PLATFORM_BY_SOCIAL: Record<string, PostDesignPlatform> = {
  instagram: 'instagram-feed',
  facebook: 'facebook-feed',
  linkedin: 'linkedin-feed',
  tiktok: 'tiktok-cover',
  x: 'x-post',
  twitter: 'x-post',
  threads: 'instagram-feed',
  mastodon: 'instagram-feed',
  bluesky: 'instagram-feed',
};
const TEMPLATE_EMBED_CACHE_TTL = 60 * 60 * 24 * 30; // 30 days
const RECENT_POSTS_FOR_VOICE = 5;

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
    private _designRender: DesignRenderService
  ) {}

  async deleteMedia(org: string, id: string) {
    return this._mediaRepository.deleteMedia(org, id);
  }

  getMediaById(id: string) {
    return this._mediaRepository.getMediaById(id);
  }

  getMediaByIdOrg(org: string, id: string) {
    return this._mediaRepository.getMediaByIdOrg(org, id);
  }

  async generateImage(
    prompt: string,
    org: Organization,
    generatePromptFirst?: boolean
  ) {
    const generating = await this._subscriptionService.useCredit(
      org,
      'ai_images',
      async () => {
        if (generatePromptFirst) {
          prompt = await this._openAi.generatePromptForPicture(prompt, org.id);
        }
        const dataUrl = await this._openAi.generateImage(
          prompt,
          !!generatePromptFirst
        );
        return dataUrl ? await this.storage.uploadSimple(dataUrl) : dataUrl;
      }
    );

    return generating;
  }

  async generatePostDesign(org: Organization, dto: GeneratePostDesignDto) {
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
      org.id
    );

    const cacheKey = `bg:${createHash('md5')
      .update(spec.imagePrompt.trim().toLowerCase())
      .digest('hex')}`;

    let backgroundUrl = await ioRedis.get(cacheKey);
    let cacheHit = !!backgroundUrl;

    if (!backgroundUrl) {
      backgroundUrl = await this._subscriptionService.useCredit(
        org,
        'ai_images',
        async () => {
          const dalleUrl = await this._openAi.generateImage(
            spec.imagePrompt,
            true
          );
          if (!dalleUrl) {
            throw new HttpException('DALL-E generation failed', 502);
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
    const designPlatform =
      DESIGN_PLATFORM_BY_SOCIAL[dto.platform.toLowerCase()] ?? 'instagram-feed';

    // Pass one explicit language to BOTH the design and the caption so they
    // can't diverge (each generator otherwise detects language independently
    // and the brand-kit tone can tip the design to a different language).
    const spec = await this.generatePostDesign(org, {
      prompt: dto.prompt,
      platform: designPlatform,
      language: dto.language,
    } as GeneratePostDesignDto);

    const brandKit = await this._brandKitService.getNormalized(org.id);

    const [copy, png] = await Promise.all([
      this._openAi.generateCaption(
        dto.prompt,
        dto.platform,
        brandKit ?? undefined,
        dto.language,
        org.id
      ),
      this._designRender.renderDesignToPng(spec, platformDesignSize(dto.platform)),
    ]);

    const uploaded = await this.storage.uploadSimple(
      'data:image/png;base64,' + png.toString('base64')
    );
    const media = await this._mediaRepository.saveFile(
      org.id,
      uploaded.split('/').pop() as string,
      uploaded
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
      org.id
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

    const slidesWithPrompts = carousel.slides.map(
      (s: { imageVariation?: string }) => {
        const prompt = slidePrompt(s.imageVariation);
        const cacheKey = `bg:${createHash('md5')
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
              const dalleUrl = await this._openAi.generateImage(prompt, true);
              if (!dalleUrl) {
                throw new HttpException('DALL-E generation failed', 502);
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
      throw new HttpException('DALL-E generation failed', 502);
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
    const uploaded = await this.storage.uploadFile(fakeFile);
    return this._mediaRepository.saveFile(
      org,
      uploaded.originalname,
      uploaded.path,
      `pixabay-${sourceId ?? 'unknown'}`
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
    const uploaded = await this.storage.uploadFile(fakeFile);
    return this._mediaRepository.saveFile(
      org,
      uploaded.originalname,
      uploaded.path,
      `pixabay-${sourceId ?? 'unknown'}`
    );
  }

  saveFile(org: string, fileName: string, filePath: string, originalName?: string) {
    return this._mediaRepository.saveFile(org, fileName, filePath, originalName);
  }

  getMedia(org: string, page: number, search?: string) {
    return this._mediaRepository.getMedia(org, page, search);
  }

  saveMediaInformation(org: string, data: SaveMediaInformationDto) {
    return this._mediaRepository.saveMediaInformation(org, data);
  }

  getVideoOptions() {
    return this._videoManager.getAllVideos();
  }

  async generateVideoAllowed(org: Organization, type: string) {
    const video = this._videoManager.getVideoByName(type);
    if (!video) {
      throw new Error(`Video type ${type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    return true;
  }

  async generateVideo(org: Organization, body: VideoDto) {
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
      throw new Error(`Video type ${body.type} not found`);
    }

    if (!video.trial && org.isTrailing) {
      throw new HttpException('This video is not available in trial mode', 406);
    }

    await video.instance.processAndValidate(body.customParams);

    return await this._subscriptionService.useCredit(
      org,
      'ai_videos',
      async () => {
        const loadedData = await video.instance.process(
          body.output,
          body.customParams
        );

        const file = await this.storage.uploadSimple(loadedData);
        return this.saveFile(org.id, file.split('/').pop(), file);
      }
    );
  }

  async videoFunction(identifier: string, functionName: string, body: any) {
    const video = this._videoManager.getVideoByName(identifier);
    if (!video) {
      throw new Error(`Video with identifier ${identifier} not found`);
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
    body: TemplateSearchDto
  ): Promise<{ id: string; score: number }[]> {
    if (!body.templates.length) return [];

    // The key has to cover the TEXTS, not just the ids: the client sends both,
    // and the ids alone are identical across languages and across template
    // edits. Keyed by id only, whoever searched first — any org, in whichever
    // language their UI happened to be — defined the embeddings everyone else
    // matched against for the next 30 days.
    const corpus = body.templates
      .map((t) => `${t.id} ${t.text}`)
      .sort()
      .join('|');
    const corpusHash = createHash('md5').update(corpus).digest('hex');
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
      const texts = body.templates.map((t) => t.text);
      const vectors = await this._studioAi.embedBatch(texts);
      embeddings = body.templates.map((t, i) => ({ id: t.id, embedding: vectors[i] }));
      await ioRedis.set(
        cacheKey,
        JSON.stringify(embeddings),
        'EX',
        TEMPLATE_EMBED_CACHE_TTL
      );
    }

    const queryEmbedding = await this._studioAi.embedText(body.query);
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
