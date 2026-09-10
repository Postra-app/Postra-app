import { AiUsageCallbackHandler } from '@gitroom/nestjs-libraries/services/ai-usage.langchain';
import {
  UNTRUSTED_SOURCE_RULE,
  wrapUntrusted,
} from '@gitroom/nestjs-libraries/openai/untrusted-source';
import { HttpException, Injectable } from '@nestjs/common';
// eslint-disable-next-line @nx/enforce-module-boundaries
import { fetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { AutopostRepository } from '@gitroom/nestjs-libraries/database/prisma/autopost/autopost.repository';
import { AutopostDto } from '@gitroom/nestjs-libraries/dtos/autopost/autopost.dto';
import dayjs from 'dayjs';
import { END, START, StateGraph } from '@langchain/langgraph';
import { AutoPost, Integration } from '@prisma/client';
import { BaseMessage } from '@langchain/core/messages';
import striptags from 'striptags';
import { ChatOpenAI } from '@langchain/openai';
import { JSDOM } from 'jsdom';
import { z } from 'zod';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import Parser from 'rss-parser';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
import { buildBrandContext } from '@gitroom/nestjs-libraries/openai/brand-prompt';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { toInstagramSafeAspect } from '@gitroom/nestjs-libraries/integrations/social/instagram.aspect';
import { TemporalService } from 'nestjs-temporal-core';
import { TypedSearchAttributes } from '@temporalio/common';
import {
  organizationId,
} from '@gitroom/nestjs-libraries/temporal/temporal.search.attribute';
const parser = new Parser();

interface PlatformContent {
  linkedin: string;
  twitter: string;
  instagram: string;
  facebook: string;
  generic: string;
}

interface WorkflowChannelsState {
  messages: BaseMessage[];
  integrations: Integration[];
  body: AutoPost;
  description: string;
  platformContent?: PlatformContent;
  image: string;
  // Why the post is going out without a picture, when the user asked for one.
  // 'credits' is the case worth telling them about — nothing they did is wrong
  // and nothing will fix itself until the cycle rolls over or the plan changes.
  imageSkipped?: 'credits' | 'failed';
  id: string;
  load: {
    date: string;
    url: string;
    description: string;
  };
  /** Brand Kit rendered once per item — voice for the copy, palette for the picture. */
  brandVoice?: string;
  brandVisual?: string;
}

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
  // gpt-4.1-mini: ~5x cheaper than gpt-4.1 with negligible quality drop for
  // short social captions generated from an article (no complex reasoning).
  model: 'gpt-4.1-mini',
  temperature: 0.7,
  // A hung OpenAI call otherwise pins the Temporal activity until its
  // startToClose timeout (same 90s/2-retries budget as OpenaiService).
  timeout: 90000,
  maxRetries: 2,
});

// Reuse the same storage backend as the rest of the app (local / cloudflare / s3).
const storage = UploadFactory.createStorage();

const generatePlatformContent = z.object({
  linkedin: z
    .string()
    .describe('LinkedIn post: professional tone, 150-200 words, line breaks between paragraphs, end with engaging question'),
  twitter: z
    .string()
    .describe('X/Twitter post: max 250 chars, punchy hook, include 1-2 hashtags at end'),
  instagram: z
    .string()
    .describe('Instagram caption: scroll-stopping first line, 2-3 paragraphs, CTA, then 5 relevant hashtags after line break'),
  facebook: z
    .string()
    .describe('Facebook post: casual friendly tone, 2-3 sentences, CTA to read full article'),
  generic: z
    .string()
    .describe('Generic social post: engaging, 1-2 sentences, universal'),
});

const dallePrompt = z.object({
  generatedTextToBeSentToDallE: z
    .string()
    .describe('Generated prompt from description to be sent to DallE'),
});

@Injectable()
export class AutopostService {
  constructor(
    private _autopostsRepository: AutopostRepository,
    private _temporalService: TemporalService,
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _notificationService: NotificationService,
    private _openaiService: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _brandKitService: BrandKitService
  ) {}

  // AutoPost publishes unattended, so it is the surface where an off-brand
  // voice or a stock-looking picture goes out without anyone reading it first.
  // One read per feed item, at the top of the graph.
  async loadBrand(state: WorkflowChannelsState) {
    const kit = await this._brandKitService.getNormalized(
      state.body.organizationId
    );
    return {
      ...state,
      brandVoice: buildBrandContext(kit, { voice: true }),
      brandVisual: buildBrandContext(kit, { palette: true }),
    };
  }

  // Autopost produces text + (optional) image. Skip platforms that can't accept
  // that shape so we never schedule a post doomed to fail at publish time.
  static readonly VIDEO_ONLY_PROVIDERS = new Set(['tiktok', 'youtube']);
  static readonly IMAGE_REQUIRED_PROVIDERS = new Set([
    'instagram',
    'instagram-standalone',
    'pinterest',
  ]);

  // Cap items processed per hourly run so a feed that publishes a burst (or a
  // first sync without syncLast) can't flood every connected channel at once.
  static readonly MAX_ITEMS_PER_RUN = 5;

  async stopAll(org: string) {
    const getAll = (await this.getAutoposts(org)).filter((f) => f.active);
    for (const autopost of getAll) {
      await this.changeActive(org, autopost.id, false);
    }
  }

  getAutoposts(orgId: string) {
    return this._autopostsRepository.getAutoposts(orgId);
  }

  getTotal(orgId: string) {
    return this._autopostsRepository.getTotal(orgId);
  }

  async createAutopost(orgId: string, body: AutopostDto, id?: string) {
    const data = await this._autopostsRepository.createAutopost(
      orgId,
      body,
      id
    );

    await this.processCron(body.active, orgId, data.id);

    return data;
  }

  async changeActive(orgId: string, id: string, active: boolean) {
    const data = await this._autopostsRepository.changeActive(
      orgId,
      id,
      active
    );
    await this.processCron(active, orgId, id);
    return data;
  }

  async processCron(active: boolean, orgId: string, id: string) {
    if (active) {
      // TERMINATE_EXISTING makes (re)activation idempotent: starting with an
      // already-running workflowId replaces it instead of throwing
      // WorkflowExecutionAlreadyStarted. Without it, a swallowed throw would
      // fall through to terminateWorkflow below and silently kill the live
      // autopost on every edit / repeat toggle.
      try {
        return await this._temporalService.client
          .getRawClient()
          ?.workflow.start('autoPostWorkflow', {
            workflowId: `autopost-${id}`,
            taskQueue: 'main',
            workflowIdConflictPolicy: 'TERMINATE_EXISTING',
            args: [{ id, immediately: true }],
            typedSearchAttributes: new TypedSearchAttributes([
              {
                key: organizationId,
                value: orgId,
              },
            ]),
          });
      } catch (err) {
        return false;
      }
    }

    try {
      return await this._temporalService.terminateWorkflow(`autopost-${id}`);
    } catch (err) {
      return false;
    }
  }

  async deleteAutopost(orgId: string, id: string) {
    const data = await this._autopostsRepository.deleteAutopost(orgId, id);
    await this.processCron(false, orgId, id);
    return data;
  }

  // rss-parser's parseURL uses its own HTTP client that re-resolves DNS and
  // follows redirects, so the isSafePublicHttpsUrl pre-check can be defeated by
  // a redirect to an internal host or a DNS-rebind. Fetch the body ourselves
  // through the SSRF-pinned dispatcher (no redirects, timeout) and parse the
  // string, matching the guarantees of the other autopost fetches.
  private async fetchFeed(url: string) {
    const res = await fetch(url, {
      dispatcher: ssrfSafeDispatcher,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' },
    });
    const body = await res.text();
    return parser.parseString(body);
  }

  async loadXML(url: string) {
    try {
      if (!(await isSafePublicHttpsUrl(url))) {
        return { success: false };
      }
      const { items } = await this.fetchFeed(url);
      if (!items?.length) {
        return { success: false };
      }

      // Most feeds carry pubDate → pick the newest by date. Feeds without any
      // valid pubDate are virtually always newest-first, so fall back to items[0]
      // instead of the 100-years-ago seed (which has no link → garbage post).
      const hasDates = items.some(
        (i: any) => i.pubDate && dayjs(i.pubDate).isValid()
      );
      const findLast = hasDates
        ? items.reduce(
            (all: any, current: any) =>
              dayjs(current.pubDate).isAfter(all.pubDate) ? current : all,
            { pubDate: dayjs().subtract(100, 'years') }
          )
        : items[0];

      if (!findLast?.link) {
        return { success: false };
      }

      return {
        success: true,
        date: findLast.pubDate,
        url: findLast.link,
        description: striptags(
          findLast?.['content:encoded'] ||
            findLast?.content ||
            findLast?.description ||
            ''
        )
          .replace(/\n/g, ' ')
          .trim(),
      };
    } catch (err) {
      /** sent **/
    }

    return { success: false };
  }

  private itemToLoad(item: any) {
    return {
      date: item.pubDate,
      url: item.link,
      description: striptags(
        item?.['content:encoded'] || item?.content || item?.description || ''
      )
        .replace(/\n/g, ' ')
        .trim(),
    };
  }

  // Return loads for every feed item newer than lastUrl, oldest-first and
  // capped, so a burst of new articles isn't collapsed into a single post.
  // If lastUrl rolled off the feed we only take the newest item (never the
  // whole backlog).
  async loadNewLoads(
    url: string,
    lastUrl: string,
    max = AutopostService.MAX_ITEMS_PER_RUN
  ) {
    try {
      if (!(await isSafePublicHttpsUrl(url))) {
        return [];
      }
      const { items } = await this.fetchFeed(url);
      const valid = (items || []).filter((i: any) => i?.link);
      if (!valid.length) {
        return [];
      }

      const hasDates = valid.some(
        (i: any) => i.pubDate && dayjs(i.pubDate).isValid()
      );
      const ordered = hasDates
        ? [...valid].sort(
            (a: any, b: any) =>
              dayjs(b.pubDate).valueOf() - dayjs(a.pubDate).valueOf()
          )
        : valid;

      const idx = ordered.findIndex((i: any) => i.link === lastUrl);
      const fresh = idx === -1 ? ordered.slice(0, 1) : ordered.slice(0, idx);

      return fresh
        .slice(0, max)
        .reverse()
        .map((i: any) => this.itemToLoad(i));
    } catch (err) {
      return [];
    }
  }

  private async notifyFailure(getPost: AutoPost, err: any) {
    try {
      await this._notificationService.inAppNotification(
        getPost.organizationId,
        'Autopost failed',
        `Autopost "${getPost.title}" could not publish the latest item from ${
          getPost.url
        }: ${String(err?.message || err)}`,
        false,
        false,
        'fail'
      );
    } catch (e) {
      /** never let a failed notification mask the original error path **/
    }
  }

  static state = () =>
    new StateGraph<WorkflowChannelsState>({
      channels: {
        messages: {
          reducer: (currentState, updateValue) =>
            currentState.concat(updateValue),
          default: (): any[] => [],
        },
        body: null,
        description: null,
        platformContent: null,
        load: null,
        image: null,
        imageSkipped: null,
        integrations: null,
        id: null,
        brandVoice: null,
        brandVisual: null,
      },
    });

  async loadUrl(url: string) {
    try {
      // Feed-item links are attacker-controllable (hostile/compromised RSS
      // feed) — pin DNS and refuse private ranges, and never hang the workflow.
      if (!(await isSafePublicHttpsUrl(url))) {
        return '';
      }
      const loadDom = new JSDOM(
        await (
          await fetch(url, {
            dispatcher: ssrfSafeDispatcher,
            signal: AbortSignal.timeout(10000),
          })
        ).text()
      );
      loadDom.window.document
        .querySelectorAll('script')
        .forEach((s) => s.remove());
      loadDom.window.document
        .querySelectorAll('style')
        .forEach((s) => s.remove());
      // remove all html, script and styles
      return striptags(loadDom.window.document.body.innerHTML);
    } catch (err) {
      return '';
    }
  }

  async generateDescription(state: WorkflowChannelsState) {
    if (!state.body.generateContent) {
      return {
        ...state,
        description: state.body.content,
      };
    }

    const description =
      state.load.description || (await this.loadUrl(state.load.url));
    if (!description) {
      return {
        ...state,
        description: '',
      };
    }

    // The per-autopost tone wins when the user set one; otherwise the org's
    // Brand Kit speaks, and only with neither do we fall back to a default.
    const toneInstruction = state.body.tone
      ? `- Tone of voice: ${state.body.tone}`
      : state.brandVoice
      ? `- ${state.brandVoice}`
      : '- Tone: professional but approachable';

    // Extra brand/topic context from the user (e.g. "fitness brand, add one
    // actionable gym tip"). Layered ON TOP of the per-platform rules — it must
    // not override the hard platform constraints (language, length limits,
    // hashtag counts). Passed as a template variable (not string-interpolated)
    // so any { } the user types stays literal and never breaks the f-string.
    const extraInstructions = state.body.customInstructions?.trim()
      ? `Additional context from the user — weave it in where relevant, but ALWAYS keep the per-platform rules above (language, length limits, hashtag counts):\n        ${state.body.customInstructions.trim()}`
      : '';

    const structuredOutput = model.withStructuredOutput(generatePlatformContent);
    const platformContent = await ChatPromptTemplate.fromTemplate(
      `
        You are a social media assistant. Based on the article, generate posts tailored to each platform.

        ${UNTRUSTED_SOURCE_RULE}

        Rules:
        - Write in the SAME language as the article (article in English -> posts in English; article in Polish -> posts in Polish, etc.)
        ${toneInstruction}
        - LinkedIn: professional tone, 150-200 words, short paragraphs with line breaks (\\n\\n), end with an engaging question
        - X/Twitter: max 250 characters, punchy hook, 1-2 hashtags at the end
        - Instagram: scroll-stopping first line, 2-3 value paragraphs, CTA, then \\n\\n and 5 hashtags
        - Facebook: casual friendly tone, 2-3 sentences, CTA to read the article
        - Generic: universal, 1-2 sentences, engaging
        - Use emoji where they fit
        - Do NOT add a link to the article — the link is appended automatically
        {extraInstructions}

        Article:
        {content}
      `
    )
      .pipe(structuredOutput)
      .invoke({
        // The article is scraped from someone else's site: it goes in as
        // marked data, not as more of the prompt.
        content: wrapUntrusted('article', description),
        extraInstructions,
      });

    return {
      ...state,
      description: platformContent.generic,
      platformContent,
    };
  }

  private async extractOgImage(url: string): Promise<string | null> {
    try {
      if (!(await isSafePublicHttpsUrl(url))) return null;
      const response = await fetch(url, {
        dispatcher: ssrfSafeDispatcher,
        headers: { 'User-Agent': 'PostraBot/1.0' },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) return null;
      const html = await response.text();
      const ogMatch = html.match(
        /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
      );
      if (ogMatch?.[1]) return ogMatch[1];
      const twitterMatch = html.match(
        /<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i
      );
      return twitterMatch?.[1] || null;
    } catch {
      return null;
    }
  }

  async generatePicture(state: WorkflowChannelsState) {
    const ogImage = await this.extractOgImage(state.load.url);
    if (ogImage) {
      return { ...state, image: await this.persistImage(ogImage) };
    }

    const structuredOutput = model.withStructuredOutput(dallePrompt);
    const { generatedTextToBeSentToDallE } =
      await ChatPromptTemplate.fromTemplate(
        `
        You generate a DALL-E prompt for a social media post image.
        
        Rules:
        - Style: professional editorial photography, shot on Canon EOS R5, natural lighting
        - NO text, watermarks, logos, or UI elements in the image
        - NO obvious AI artifacts (extra fingers, distorted faces, floating objects)
        - Prefer: clean compositions, shallow depth of field, muted corporate color palette
        - If topic is abstract (software, data, AI) — use metaphorical real-world objects (desk setup, office, city, nature)
        - Aspect ratio: 16:9 landscape
        {brand}
        
        Article topic:
        {content}
      `
      )
        .pipe(structuredOutput)
        .invoke({
          content: state.load.description || state.description,
          brand: state.brandVisual ? `- ${state.brandVisual}` : '',
        });

    // OpenaiService.generateImage = gpt-image-2 (DallEAPIWrapper pointed at
    // 'chatgpt-image-latest', which our key cannot call), pLimit-bounded and
    // metered. Out of credits / generation failure degrades to a text-only
    // post — an autopost must never die on the image step.
    let image = '';
    let imageSkipped: 'credits' | 'failed' | undefined;
    try {
      image = await this._subscriptionService.useCreditByOrgId(
        state.body.organizationId,
        'ai_images',
        () => this._openaiService.generateImage(generatedTextToBeSentToDallE, true)
      ) || '';
    } catch (err) {
      image = '';
      imageSkipped =
        err instanceof HttpException && err.getStatus() === 402
          ? 'credits'
          : 'failed';
    }

    const persisted = image ? await this.persistImage(image) : '';
    return {
      ...state,
      image: persisted,
      imageSkipped: persisted ? undefined : imageSkipped ?? 'failed',
    };
  }

  // Persist an OG/AI image into our own storage. OG images hotlink a third-party
  // CDN and DALL-E URLs expire (~1h) — fatal once the post is a draft published
  // later. On failure, degrade to no image rather than storing a dead URL.
  private async persistImage(urlOrData: string): Promise<string> {
    if (!urlOrData) {
      return '';
    }
    try {
      const normalized = await toInstagramSafeAspect(urlOrData);
      return await storage.uploadSimple(normalized);
    } catch {
      return '';
    }
  }

  private getContentForProvider(
    providerIdentifier: string,
    state: WorkflowChannelsState
  ): string {
    if (!state.platformContent) {
      return state.description || '';
    }
    const providerMap: Record<string, keyof PlatformContent> = {
      linkedin: 'linkedin',
      'linkedin-page': 'linkedin',
      twitter: 'twitter',
      x: 'twitter',
      instagram: 'instagram',
      facebook: 'facebook',
      'facebook-page': 'facebook',
      threads: 'instagram',
      tiktok: 'generic',
      youtube: 'generic',
      pinterest: 'generic',
    };
    const key = providerMap[providerIdentifier] || 'generic';
    return state.platformContent[key] || state.description || '';
  }

  async schedulePost(state: WorkflowChannelsState) {
    // Image-required platforms (Instagram, Pinterest) can't publish a text-only
    // post; drop them when no image was produced rather than failing at publish.
    const integrations = state.image
      ? state.integrations
      : state.integrations.filter(
          (i) =>
            !AutopostService.IMAGE_REQUIRED_PROVIDERS.has(i.providerIdentifier)
        );
    if (integrations.length === 0) {
      return;
    }

    const orgId = integrations[0].organizationId;
    const useSlot = state.body.onSlot;
    const date = useSlot
      ? (await this._postsService.findFreeDateTime(orgId)) + 'Z'
      : new Date().toISOString();

    await this._postsService.createPost(orgId, {
      date,
      order: makeId(10),
      shortLink: false,
      // useSlot -> 'schedule' queues the post at the next free slot so it
      // actually auto-publishes (legacy 'draft' created a never-published draft
      // despite the "post on next available slot" label). !useSlot -> publish now.
      type: useSlot ? 'schedule' : 'now',
      tags: [],
      posts: integrations.map((i) => ({
        settings: {
          __type: i.providerIdentifier as any,
          title: '',
          tags: [],
          subreddit: [],
          // Instagram's DTO requires post_type. Publishing tolerates the gap
          // (provider defaults to a feed post), but a failed post can't be
          // re-published from the editor — validation blocks Update until the
          // user picks a type by hand.
          ...(i.providerIdentifier.startsWith('instagram')
            ? { post_type: 'post' as const }
            : {}),
        },
        group: makeId(10),
        integration: { id: i.id },
        value: [
          {
            id: makeId(10),
            delay: 0,
            content:
              this.getContentForProvider(i.providerIdentifier, state) +
              '\n\n' +
              state.load.url,
            image: !state.image
              ? []
              : [
                  {
                    id: makeId(10),
                    name: makeId(10),
                    path: state.image,
                    organizationId: orgId,
                  },
                ],
          },
        ],
      })),
    }, 'AUTOPOST');
  }

  async updateUrl(state: WorkflowChannelsState) {
    await this._autopostsRepository.updateUrl(state.id, state.load.url);
  }

  async startAutopost(id: string) {
    const getPost = await this._autopostsRepository.getAutopost(id);
    if (!getPost || !getPost.active) {
      return;
    }

    let loads: { date: any; url: string; description: string }[];

    if (!getPost.lastUrl) {
      // First activation: consider only the newest item so we never replay the
      // whole feed history.
      const newest = await this.loadXML(getPost.url);
      if (!newest.success) {
        return;
      }
      // "sync last": remember the current latest item as already seen so
      // enabling an autopost doesn't immediately republish an old article.
      if (getPost.syncLast) {
        await this._autopostsRepository.updateUrl(id, newest.url);
        return;
      }
      loads = [
        {
          date: newest.date,
          url: newest.url,
          description: newest.description,
        },
      ];
    } else {
      loads = await this.loadNewLoads(getPost.url, getPost.lastUrl);
    }

    if (!loads.length) {
      return;
    }

    const integrations = await this._integrationService.getIntegrationsList(
      getPost.organizationId
    );

    const parseIntegrations = JSON.parse(getPost.integrations || '[]') || [];
    const neededIntegrations = integrations.filter((i) =>
      parseIntegrations.some((ii: any) => ii.id === i.id)
    );

    const selected =
      parseIntegrations.length === 0 ? integrations : neededIntegrations;

    const integrationsToSend = selected.filter(
      (i) => !AutopostService.VIDEO_ONLY_PROVIDERS.has(i.providerIdentifier)
    );
    if (integrationsToSend.length === 0) {
      return;
    }

    const app = AutopostService.state()
      .addNode('load-brand', this.loadBrand.bind(this))
      .addNode('generate-description', this.generateDescription.bind(this))
      .addNode('generate-picture', this.generatePicture.bind(this))
      .addNode('schedule-post', this.schedulePost.bind(this))
      .addNode('update-url', this.updateUrl.bind(this))
      .addEdge(START, 'load-brand')
      .addEdge('load-brand', 'generate-description')
      .addConditionalEdges(
        'generate-description',
        (state: WorkflowChannelsState) => {
          if (!state.description) {
            return 'schedule-post';
          }
          if (state.body.addPicture) {
            return 'generate-picture';
          }
          return 'schedule-post';
        }
      )
      .addEdge('generate-picture', 'schedule-post')
      .addEdge('schedule-post', 'update-url')
      .addEdge('update-url', END)
      .compile();

    // Oldest-first so update-url advances lastUrl in order. Stop on the first
    // failure (and surface it) so lastUrl never skips past an unposted item —
    // the hourly run resumes from there next time.
    let postsWithoutImage = 0;
    for (const load of loads) {
      try {
        const result = await app.invoke(
          {
            messages: [],
            id,
            body: getPost,
            load,
            integrations: integrationsToSend,
          },
          {
            callbacks: [
              new AiUsageCallbackHandler({
                organizationId: getPost.organizationId,
                engine: 'autopost',
                model: 'gpt-4.1-mini',
              }),
            ],
          }
        );
        if (result?.imageSkipped === 'credits') {
          postsWithoutImage++;
        }
      } catch (err) {
        await this.notifyFailure(getPost, err);
        break;
      }
    }

    // An autopost that quietly drops the picture looks like a bug from the
    // outside. Say it once per run, in the app only — the email policy keeps
    // routine notices off the sender reputation.
    if (postsWithoutImage) {
      await this._notificationService.inAppNotification(
        getPost.organizationId,
        'Auto-post published without images',
        `${postsWithoutImage} auto-post${
          postsWithoutImage > 1 ? 's went' : ' went'
        } out without a picture: your image credits for this billing cycle are used up. The text was published as normal.`,
        false,
        false,
        'info'
      );
    }
  }
}
