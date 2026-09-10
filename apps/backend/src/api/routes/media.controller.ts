import { Throttle } from '@nestjs/throttler';
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
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { AccountAgeGuard } from '@gitroom/backend/services/auth/account-age.guard';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { Request, Response } from 'express';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { Organization } from '@prisma/client';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { ApiTags } from '@nestjs/swagger';
import handleR2Upload from '@gitroom/nestjs-libraries/upload/r2.uploader';
import handleS3Upload from '@gitroom/nestjs-libraries/upload/s3.uploader';
import { FileInterceptor } from '@nestjs/platform-express';
import { CustomFileValidationPipe } from '@gitroom/nestjs-libraries/upload/custom.upload.validation';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { GeneratePostDesignDto } from '@gitroom/nestjs-libraries/dtos/media/generate.post.design.dto';
import { GeneratePostCarouselDto } from '@gitroom/nestjs-libraries/dtos/media/generate.post.carousel.dto';
import { CaptionsService } from '@gitroom/nestjs-libraries/videos/captions/captions.service';
import { createHash } from 'crypto';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  BrandVoiceCheckDto,
  AiEditTextDto,
  SuggestHashtagsDto,
  RefineDesignDto,
  SaveCanvasJsonDto,
  SaveDesignSpecDto,
  TemplateSearchDto,
} from '@gitroom/nestjs-libraries/studio/studio.dto';
import { StudioSpec } from '@gitroom/nestjs-libraries/studio/studio-spec';

// Express turns a repeated query param (`?q=a&q=b`) into an array, so a
// `: string` annotation on @Query is a lie the caller controls: string methods
// then throw and 500 the endpoint. Collapse to a single string at the edge.
const queryString = (value: unknown): string => {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
};

const queryPage = (value: unknown): number => {
  const parsed = Number(queryString(value));
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 1;
};

@ApiTags('Media')
@Controller('/media')
export class MediaController {
  private storage = UploadFactory.createStorage();
  constructor(
    private _mediaService: MediaService,
    private _subscriptionService: SubscriptionService,
    private _captionsService: CaptionsService
  ) {}

  @Delete('/:id')
  deleteMedia(@GetOrgFromRequest() org: Organization, @Param('id') id: string) {
    return this._mediaService.deleteMedia(org.id, id);
  }

  @Post('/generate-video')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 10 } })
  @UseGuards(AccountAgeGuard)
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/generate-image')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  async generateImage(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('prompt') prompt: string,
    isPicturePrompt = false
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      throw new HttpException(
        'No image generation credits remaining for this billing cycle',
        402
      );
    }

    // generateImage generates AND uploads, returning the stored CDN URL. The
    // Polotno "AI Img" tab uses `output` directly as the image src, so return
    // the URL as-is. (The old code prefixed it with `data:image/png;base64,`,
    // yielding `data:image/png;base64,https://cdn.../x.png` — a broken src that
    // failed getImageSize/insert while still charging a credit. Same class as
    // the #108 fix on /generate-image-with-prompt.)
    const output = await this._mediaService.generateImage(
      prompt,
      org,
      isPicturePrompt
    );
    if (!output) {
      return false;
    }
    return { output };
  }

  @Post('/generate-image-with-prompt')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  async generateImageFromText(
    @GetOrgFromRequest() org: Organization,
    @Body('prompt') prompt: string
  ) {
    const total = await this._subscriptionService.checkCredits(org);
    if (process.env.STRIPE_PUBLISHABLE_KEY && total.credits <= 0) {
      // `return false` here read as a 201 with a falsy body, so the composer
      // fell through to "Could not generate the image, please try again" -
      // telling someone who is out of credits the wrong thing. Same 402 the
      // design generator already throws.
      throw new HttpException(
        'No image generation credits remaining for this billing cycle',
        402
      );
    }

    // mediaService.generateImage already generates AND uploads the image,
    // returning the stored path. Save it straight to the media library. (The
    // old code re-wrapped that path as a `data:image/png;base64,<path>` URL via
    // this.generateImage() and re-uploaded it → uploadSimple base64-decoded the
    // path → garbage → "Unsupported file type" → 500.) Returns { id, path }:
    // frontend onChange adds it to the post, saveFile records it in the library.
    const file = await this._mediaService.generateImage(prompt, org, true);
    if (!file) {
      return false;
    }

    return this._mediaService.saveFile(org.id, file.split('/').pop(), file);
  }

  @Post('/generate-post-design')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  generatePostDesign(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratePostDesignDto
  ) {
    return this._mediaService.generatePostDesign(org, body);
  }

  @Post('/generate-carousel-design')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 15 } })
  @UseGuards(AccountAgeGuard)
  generateCarouselDesign(
    @GetOrgFromRequest() org: Organization,
    @Body() body: GeneratePostCarouselDto
  ) {
    return this._mediaService.generatePostCarousel(org, body);
  }

  @Put('/:id/canvas')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  saveCanvasJson(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SaveCanvasJsonDto
  ) {
    return this._mediaService.saveCanvasJson(org.id, id, body.canvasJson);
  }

  @Put('/:id/template')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  setTemplateFlag(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { isTemplate: boolean }
  ) {
    return this._mediaService.setTemplateFlag(org.id, id, !!body.isTemplate);
  }

  // Literal GET paths (e.g. /pixabay-videos) MUST come BEFORE the
  // parameterized `@Get('/:id')` — otherwise NestJS matches them as an id and
  // they silently return "media not found" (empty body → Stock search failed).
  @Get('/my-templates')
  getMyTemplates(@GetOrgFromRequest() org: Organization) {
    return this._mediaService.getTemplates(org.id);
  }

  @Get('/pixabay-videos')
  async pixabayVideos(
    @Query('q') q: unknown,
    @Query('page') page: unknown
  ) {
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) {
      return { hits: [], note: 'PIXABAY_API_KEY not configured' };
    }
    const safeQuery = queryString(q).slice(0, 100).trim().toLowerCase();
    const safePage = queryPage(page);
    // Pixabay license requires caching responses for 24h to avoid duplicate calls.
    const cacheKey = `pixabay:videos:${createHash('md5').update(`${safeQuery}|${safePage}`).digest('hex')}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    const url = `https://pixabay.com/api/videos/?key=${apiKey}&q=${encodeURIComponent(safeQuery)}&page=${safePage}&per_page=20&safesearch=true`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new HttpException(`Pixabay error ${res.status}`, 502);
    }
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '999');
    const data = await res.json();
    // 24h cache per Pixabay TOS. Tighten when rate limit is nearly exhausted.
    const ttl = remaining < 5 ? 60 * 60 * 48 : 60 * 60 * 24;
    await ioRedis.set(cacheKey, JSON.stringify(data), 'EX', ttl);
    return data;
  }

  @Get('/pixabay-images')
  async pixabayImages(
    @Query('q') q: unknown,
    @Query('page') page: unknown
  ) {
    const apiKey = process.env.PIXABAY_API_KEY;
    if (!apiKey) {
      return { hits: [], note: 'PIXABAY_API_KEY not configured' };
    }
    const safeQuery = queryString(q).slice(0, 100).trim().toLowerCase();
    const safePage = queryPage(page);
    // Pixabay license requires caching responses for 24h to avoid duplicate calls.
    const cacheKey = `pixabay:images:${createHash('md5').update(`${safeQuery}|${safePage}`).digest('hex')}`;
    const cached = await ioRedis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
    const url = `https://pixabay.com/api/?key=${apiKey}&q=${encodeURIComponent(safeQuery)}&image_type=photo&page=${safePage}&per_page=24&safesearch=true`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new HttpException(`Pixabay error ${res.status}`, 502);
    }
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? '999');
    const data = await res.json();
    // 24h cache per Pixabay TOS. Tighten when rate limit is nearly exhausted.
    const ttl = remaining < 5 ? 60 * 60 * 48 : 60 * 60 * 24;
    await ioRedis.set(cacheKey, JSON.stringify(data), 'EX', ttl);
    return data;
  }

  @Get('/:id')
  getMediaForEdit(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaService.getMediaForEdit(org.id, id);
  }

  @Post('/:id/auto-caption')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  @UseGuards(AccountAgeGuard)
  async autoCaption(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { language?: string }
  ) {
    const media = await this._mediaService.getMediaForEdit(org.id, id);
    if (!media?.path) {
      throw new HttpException('Media not found', 404);
    }
    const srt = await this._captionsService.generateSrtFromVideoUrl(media.path, body.language, org.id);
    return { srt };
  }

  @Post('/:id/burn-captions')
  @Throttle({ default: { ttl: 300000, limit: 5 } })
  @UseGuards(AccountAgeGuard)
  async burnCaptions(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { srt: string }
  ) {
    const media = await this._mediaService.getMediaForEdit(org.id, id);
    if (!media?.path) {
      throw new HttpException('Media not found', 404);
    }
    if (!body.srt?.trim()) {
      throw new HttpException('Empty SRT', 400);
    }
    const result = await this._captionsService.burnCaptionsIntoVideo(media.path, body.srt);
    return this._mediaService.saveFile(org.id, result.path.split('/').pop() ?? 'captioned.mp4', result.path);
  }

  @Post('/pixabay-videos/import')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  async pixabayVideosImport(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { url: string; sourceId?: number }
  ) {
    if (!body.url || !/^https:\/\/(cdn\.)?pixabay\.com\//.test(body.url)) {
      throw new HttpException('Invalid Pixabay video URL', 400);
    }
    // Pixabay TOS: store video on our server rather than hotlinking.
    return this._mediaService.importPixabayVideo(org.id, body.url, body.sourceId);
  }

  @Post('/pixabay-images/import')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  async pixabayImagesImport(
    @GetOrgFromRequest() org: Organization,
    @Body() body: { url: string; sourceId?: number }
  ) {
    if (!body.url || !/^https:\/\/(cdn\.)?pixabay\.com\//.test(body.url)) {
      throw new HttpException('Invalid Pixabay image URL', 400);
    }
    // Pixabay TOS: store the image on our server rather than hotlinking.
    return this._mediaService.importPixabayImage(org.id, body.url, body.sourceId);
  }

  @Post('/refine-design')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  refineDesign(
    @GetOrgFromRequest() org: Organization,
    @Body() body: RefineDesignDto
  ) {
    return this._mediaService.refineDesign(org, body);
  }

  @Post('/brand-voice-check')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  brandVoiceCheck(
    @GetOrgFromRequest() org: Organization,
    @Body() body: BrandVoiceCheckDto
  ) {
    return this._mediaService.checkBrandVoice(org, body);
  }

  @Post('/:id/alt-text')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  generateAltText(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    return this._mediaService.generateAltText(org, id);
  }

  @Post('/suggest-hashtags')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  suggestHashtags(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SuggestHashtagsDto
  ) {
    return this._mediaService.suggestHashtags(org, body);
  }

  @Post('/ai-edit')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  aiEdit(
    @GetOrgFromRequest() org: Organization,
    @Body() body: AiEditTextDto
  ) {
    return this._mediaService.aiEditText(org, body);
  }

  @Post('/search-templates')
  @CheckPolicies([AuthorizationActions.Create, Sections.AI])
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  searchTemplates(@Body() body: TemplateSearchDto) {
    return this._mediaService.searchTemplates(body);
  }

  @Post('/:id/design-spec')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  saveDesignSpec(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: SaveDesignSpecDto
  ) {
    return this._mediaService.saveDesignSpec(org.id, id, body.spec as StudioSpec);
  }

  @Post('/upload-server')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadServer(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile() file: Express.Multer.File
  ) {
    const originalName = file?.originalname || '';
    const uploadedFile = await this.storage.uploadFile(file);
    return this._mediaService.saveFile(
      org.id,
      uploadedFile.originalname,
      uploadedFile.path,
      originalName
    );
  }

  @Post('/save-media')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  async saveMedia(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Body('name') name: string,
    @Body('originalName') originalName: string
  ) {
    if (!name) {
      return false;
    }
    return this._mediaService.saveFile(
      org.id,
      name,
      process.env.CLOUDFLARE_BUCKET_URL + '/' + name,
      originalName || undefined
    );
  }

  @Post('/information')
  saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @Body() body: SaveMediaInformationDto
  ) {
    return this._mediaService.saveMediaInformation(org.id, body);
  }

  @Post('/upload-simple')
  @Throttle({ default: { ttl: 300000, limit: 60 } })
  @UseInterceptors(FileInterceptor('file'))
  @UsePipes(new CustomFileValidationPipe())
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @Body('preventSave') preventSave: string = 'false'
  ) {
    const originalName = file.originalname;
    const getFile = await this.storage.uploadFile(file);

    if (preventSave === 'true') {
      const { path } = getFile;
      return { path };
    }

    return this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      originalName
    );
  }

  @Post('/:endpoint')
  async uploadFile(
    @GetOrgFromRequest() org: Organization,
    @Req() req: Request,
    @Res() res: Response,
    @Param('endpoint') endpoint: string
  ) {
    const upload =
      process.env.STORAGE_PROVIDER === 's3'
        ? await handleS3Upload(endpoint, req, res)
        : await handleR2Upload(endpoint, req, res);
    if (endpoint !== 'complete-multipart-upload') {
      return upload;
    }

    // complete-multipart-upload already wrote a response (e.g. a 400 when the
    // uploaded bytes failed the magic-byte check) — nothing left to save.
    if (res.headersSent) {
      return;
    }

    // @ts-ignore
    const name = upload.Location.split('/').pop();
    const originalName = req.body?.file?.name;

    const saveFile = await this._mediaService.saveFile(
      org.id,
      name,
      // @ts-ignore
      upload.Location,
      originalName || undefined
    );

    res.status(200).json({ ...upload, saved: saveFile });
  }

  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @Query('page') page: unknown,
    @Query('search') search?: unknown
  ) {
    return this._mediaService.getMedia(
      org.id,
      queryPage(page),
      queryString(search) || undefined
    );
  }

  @Get('/video-options')
  getVideos() {
    return this._mediaService.getVideoOptions();
  }

  @Post('/video/function')
  @Throttle({ default: { ttl: 300000, limit: 30 } })
  @UseGuards(AccountAgeGuard)
  videoFunction(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoFunctionDto
  ) {
    return this._mediaService.videoFunction(
      body.identifier,
      body.functionName,
      body.params
    );
  }

  @Get('/generate-video/:type/allowed')
  generateVideoAllowed(
    @GetOrgFromRequest() org: Organization,
    @Param('type') type: string
  ) {
    return this._mediaService.generateVideoAllowed(org, type);
  }
}
