import { HttpException, Injectable } from '@nestjs/common';
import { wrapUntrusted } from '@gitroom/nestjs-libraries/openai/untrusted-source';
import {
  BaseMessage,
  HumanMessage,
  ToolMessage,
} from '@langchain/core/messages';
import { END, START, StateGraph } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { TavilySearch } from '@langchain/tavily';
import { ToolNode } from '@langchain/langgraph/prebuilt';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import dayjs from 'dayjs';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { category, contentZod, hook, topic } from './agent.schemas';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { OpenaiService } from '@gitroom/nestjs-libraries/openai/openai.service';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { AiUsageCallbackHandler } from '@gitroom/nestjs-libraries/services/ai-usage.langchain';
import { GeneratorDto } from '@gitroom/nestjs-libraries/dtos/generator/generator.dto';
import { BrandKitService } from '@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service';
import { buildBrandContext } from '@gitroom/nestjs-libraries/openai/brand-prompt';
import { languageRule } from '@gitroom/nestjs-libraries/openai/language-rule';

const tools = !process.env.TAVILY_API_KEY
  ? []
  : [new TavilySearch({ maxResults: 3 })];
// Resolved through the packages' "exports", @langchain/tavily and
// @langchain/langgraph see two copies of @langchain/core's declarations (CJS
// and ESM), so the same tool class does not match by type. It is the same
// class at run time.
const toolNode = new ToolNode(tools as unknown as ConstructorParameters<typeof ToolNode>[0]);

const model = new ChatOpenAI({
  apiKey: process.env.OPENAI_API_KEY || 'sk-proj-',
  model: 'gpt-4.1',
  temperature: 0.7,
  // A hung OpenAI call otherwise pins the streaming /posts/generator response
  // forever (same 90s/2-retries budget as OpenaiService).
  timeout: 90000,
  maxRetries: 2,
});

interface WorkflowChannelsState {
  messages: BaseMessage[];
  orgId: string;
  question: string;
  hook?: string;
  fresearch?: string;
  category?: string;
  topic?: string;
  date?: string;
  format: 'one_short' | 'one_long' | 'thread_short' | 'thread_long';
  tone: 'personal' | 'company';
  content?: {
    content: string;
    website?: string | null;
    prompt?: string;
    image?: string;
  }[];
  isPicture?: boolean;
  popularPosts?: { content: string; hook: string }[];
  /** Brand Kit rendered once per run — voice for the copy, palette for the picture. */
  brandVoice?: string;
  brandVisual?: string;
  /** Why the posts came back without pictures, when they did. */
  imagesSkipped?: 'credits' | 'failed';
}

// What the browser is told while the graph runs: the step that started, then
// one last line with the posts. The graph's own events carry its whole state
// with every step (the prompts, the research, each picture as base64 several
// times over), and the modal only ever read the step name and the result.
export type GeneratorLine =
  | { name: string }
  | {
      name: 'done';
      data: {
        output: Pick<
          WorkflowChannelsState,
          'hook' | 'content' | 'date' | 'imagesSkipped'
        >;
      };
    };

const GENERATOR_STEPS = new Set([
  'agent',
  'research',
  'find-category',
  'find-topic',
  'find-popular-posts',
  'generate-hook',
  'generate-content',
  'generate-picture',
  'upload-pictures',
  'post-time',
]);

@Injectable()
export class AgentGraphService {
  private storage = UploadFactory.createStorage();
  constructor(
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _openaiService: OpenaiService,
    private _subscriptionService: SubscriptionService,
    private _brandKitService: BrandKitService
  ) {}

  // One read per run, at the top of the graph: the hook, the content and the
  // picture prompts all need the kit, and the Creator used to ignore it
  // entirely — posts came back in a generic voice with a generic image.
  async loadBrand(state: WorkflowChannelsState) {
    const kit = await this._brandKitService.getNormalized(state.orgId);
    return {
      brandVoice: buildBrandContext(kit, { voice: true }),
      brandVisual: buildBrandContext(kit, { palette: true, logoHint: true }),
    };
  }
  static state = () =>
    new StateGraph<WorkflowChannelsState>({
      channels: {
        messages: {
          reducer: (currentState, updateValue) =>
            currentState.concat(updateValue),
          default: (): any[] => [],
        },
        fresearch: null,
        format: null,
        tone: null,
        question: null,
        orgId: null,
        hook: null,
        content: null,
        date: null,
        category: null,
        popularPosts: null,
        topic: null,
        isPicture: null,
        brandVoice: null,
        brandVisual: null,
        imagesSkipped: null,
      },
    });

  async startCall(state: WorkflowChannelsState) {
    const runTools = model.bindTools(tools);
    const response = await ChatPromptTemplate.fromTemplate(
      `
    Today is ${dayjs().format()}, You are an assistant that gets a social media post or requests for a social media post.
    You research should be on the most possible recent data.
    You concat the text of the request together with an internet research based on the text.
    {text}
    `
    )
      .pipe(runTools)
      .invoke({
        text: state.messages[state.messages.length - 1].content,
      });

    return { messages: [response] };
  }

  async saveResearch(state: WorkflowChannelsState) {
    const content = state.messages.filter((f) => f instanceof ToolMessage);
    // Web search results feed four later prompts. Wrapping them here means
    // every one of those gets the marked version, and the rule travels with
    // the text instead of being repeated in each template.
    return {
      fresearch: wrapUntrusted(
        'web_research',
        typeof content === 'string' ? content : JSON.stringify(content)
      ),
    };
  }

  async findCategories(state: WorkflowChannelsState) {
    const allCategories = await this._postsService.findAllExistingCategories();
    // Nothing to choose from (the table of popular posts is empty): the model
    // was asked to pick a category out of an empty list on every run.
    if (allCategories.length === 0) {
      return { category: null };
    }
    const structuredOutput = model.withStructuredOutput(category);
    const { category: outputCategory } = await ChatPromptTemplate.fromTemplate(
      `
        You are an assistant that gets a text that will be later summarized into a social media post
        and classify it to one of the following categories: {categories}
        text: {text}
      `
    )
      .pipe(structuredOutput)
      .invoke({
        categories: allCategories.map((p) => p.category).join(', '),
        text: state.fresearch || state.messages[0].content,
      });

    return {
      category: outputCategory,
    };
  }

  async findTopic(state: WorkflowChannelsState) {
    if (!state.category) {
      return { topic: null };
    }
    const allTopics = await this._postsService.findAllExistingTopicsOfCategory(
      state.category
    );
    if (allTopics.length === 0) {
      return { topic: null };
    }

    const structuredOutput = model.withStructuredOutput(topic);
    const { topic: outputTopic } = await ChatPromptTemplate.fromTemplate(
      `
        You are an assistant that gets a text that will be later summarized into a social media post
        and classify it to one of the following topics: {topics}
        text: {text}
      `
    )
      .pipe(structuredOutput)
      .invoke({
        topics: allTopics.map((p) => p.topic).join(', '),
        text: state.fresearch || state.messages[0].content,
      });

    return {
      topic: outputTopic,
    };
  }

  async findPopularPosts(state: WorkflowChannelsState) {
    if (!state.category) {
      return { popularPosts: [] };
    }
    const popularPosts = await this._postsService.findPopularPosts(
      state.category!,
      state.topic
    );
    return { popularPosts };
  }

  async generateHook(state: WorkflowChannelsState) {
    const structuredOutput = model.withStructuredOutput(hook);
    const { hook: outputHook } = await ChatPromptTemplate.fromTemplate(
      `
        You are an assistant that gets content for a social media post, and generate only the hook.
        The hook is the 1-2 sentences of the post that will be used to grab the attention of the reader.
        You will be provided existing hooks you should use as inspiration.
        - Avoid weird hook that starts with "Discover the secret...", "The best...", "The most...", "The top..."
        - Make sure it sounds ${state.tone}
        - Use ${state.tone === 'personal' ? '1st' : '3rd'} person mode
        - Make sure it's engaging
        - Don't be cringy
        - Keep the wording simple
        {language}
        - Make sure you add "\n" between the lines
        - Don't take the hook from "request of the user"
        {brand}

        <!-- BEGIN request of the user -->
        {request}
        <!-- END request of the user -->
        
        <!-- BEGIN existing hooks -->
        {hooks}
        <!-- END existing hooks -->
        
        <!-- BEGIN current content -->
        {text}
        <!-- END current content -->
       
      `
    )
      .pipe(structuredOutput)
      .invoke({
        request: state.messages[0].content,
        hooks: (state.popularPosts || []).map((p) => p.hook).join('\n'),
        text: state.fresearch || '',
        brand: state.brandVoice || '',
        language: languageRule({ follow: "the user's request" }),
      });

    return {
      hook: outputHook,
    };
  }

  async generateContent(state: WorkflowChannelsState) {
    const structuredOutput = model.withStructuredOutput(
      contentZod(!!state.isPicture, state.format)
    );
    const { content: outputContent } = await ChatPromptTemplate.fromTemplate(
      `
        You are an assistant that gets existing hook of a social media, content and generate only the content.
        - Don't add any hashtags
        - Make sure it sounds ${state.tone}
        - Use ${state.tone === 'personal' ? '1st' : '3rd'} person mode
        - ${
          state.format === 'one_short' || state.format === 'thread_short'
            ? 'Post should be maximum 200 chars to fit twitter'
            : 'Post should be long'
        }
        - ${
          state.format === 'one_short' || state.format === 'one_long'
            ? 'Post should have only 1 item'
            : 'Post should have minimum 2 items'
        }
        - Use the hook as inspiration
        - Make sure it's engaging
        - Don't be cringy
        - Keep the wording simple
        {language}
        - The Content should not contain the hook
        - Try to put some call to action at the end of the post
        - Make sure you add "\n" between the lines
        - Add "\n" after every "."
        {brand}
        
        Hook:
        {hook}
        
        User request:
        {request}
        
        current content information:
        {information}
      `
    )
      .pipe(structuredOutput)
      .invoke({
        hook: state.hook,
        request: state.messages[0].content,
        information: state.fresearch || '',
        brand: state.brandVoice || '',
        language: languageRule({ follow: "the user's request" }),
      });

    return {
      content: outputContent,
    };
  }

  async fixArray(state: WorkflowChannelsState) {
    if (state.format === 'one_short' || state.format === 'one_long') {
      return {
        content: [state.content],
      };
    }

    return {};
  }

  async generatePictures(state: WorkflowChannelsState) {
    if (!state.isPicture) {
      return {};
    }

    // OpenaiService.generateImage = gpt-image-2 (DallEAPIWrapper pointed at
    // 'chatgpt-image-latest', which our key cannot call), pLimit-bounded, and
    // metered: each image burns an ai_images credit like every other AI image.
    // Out of image credits, the signup hour, or the image model failing: the
    // posts are written by now, so they go back without the picture and the
    // modal says why. It used to throw here, which cut the stream and lost
    // the text as well.
    let imagesSkipped: 'credits' | 'failed' | undefined;
    const newContent = await Promise.all(
      (state.content || []).map(async (p) => {
        const prompt = state.brandVisual
          ? `${p.prompt!}\n\n${state.brandVisual}`
          : p.prompt!;
        try {
          const image = await this._subscriptionService.useCreditByOrgId(
            state.orgId,
            'ai_images',
            () =>
              this._openaiService.generateImage(prompt, true, false, {
                orgId: state.orgId,
                engine: 'generate-posts',
              })
          );
          return {
            ...p,
            image,
          };
        } catch (err) {
          const credits =
            err instanceof HttpException &&
            [402, 403].includes(err.getStatus());
          imagesSkipped = credits ? 'credits' : imagesSkipped || 'failed';
          return p;
        }
      })
    );

    return {
      content: newContent,
      ...(imagesSkipped ? { imagesSkipped } : {}),
    };
  }

  async uploadPictures(state: WorkflowChannelsState) {
    const all = await Promise.all(
      (state.content || []).map(async (p) => {
        if (p.image) {
          const upload = await this.storage.uploadSimple(p.image);
          const name = upload.split('/').pop()!;
          const uploadWithId = await this._mediaService.saveFile(
            state.orgId,
            name,
            upload,
            undefined,
            true
          );

          return {
            ...p,
            image: uploadWithId,
          };
        }

        return p;
      })
    );

    return { content: all };
  }

  async isGeneratePicture(state: WorkflowChannelsState) {
    if (state.isPicture) {
      return 'generate-picture';
    }

    return 'post-time';
  }

  async postDateTime(state: WorkflowChannelsState) {
    return { date: await this._postsService.findFreeDateTime(state.orgId) };
  }

  start(orgId: string, body: GeneratorDto) {
    // Without a search tool the first model call had nothing to call: its
    // answer was thrown away and "research" was an empty list. The two steps
    // only exist when there is a tool to run.
    const withResearch = tools.length > 0;
    const state = AgentGraphService.state();
    const workflow = state
      .addNode('load-brand', this.loadBrand.bind(this))
      .addNode('agent', this.startCall.bind(this))
      .addNode('research', toolNode)
      .addNode('save-research', this.saveResearch.bind(this))
      .addNode('find-category', this.findCategories.bind(this))
      .addNode('find-topic', this.findTopic.bind(this))
      .addNode('find-popular-posts', this.findPopularPosts.bind(this))
      .addNode('generate-hook', this.generateHook.bind(this))
      .addNode('generate-content', this.generateContent.bind(this))
      .addNode('generate-content-fix', this.fixArray.bind(this))
      .addNode('generate-picture', this.generatePictures.bind(this))
      .addNode('upload-pictures', this.uploadPictures.bind(this))
      .addNode('post-time', this.postDateTime.bind(this))
      .addEdge(START, 'load-brand')
      .addEdge('load-brand', withResearch ? 'agent' : 'find-category')
      .addEdge('agent', 'research')
      .addEdge('research', 'save-research')
      .addEdge('save-research', 'find-category')
      .addEdge('find-category', 'find-topic')
      .addEdge('find-topic', 'find-popular-posts')
      .addEdge('find-popular-posts', 'generate-hook')
      .addEdge('generate-hook', 'generate-content')
      .addEdge('generate-content', 'generate-content-fix')
      .addConditionalEdges(
        'generate-content-fix',
        this.isGeneratePicture.bind(this)
      )
      .addEdge('generate-picture', 'upload-pictures')
      .addEdge('upload-pictures', 'post-time')
      .addEdge('post-time', END);

    const app = workflow.compile();

    return app.streamEvents(
      {
        messages: [new HumanMessage(body.research)],
        isPicture: body.isPicture,
        format: body.format,
        tone: body.tone,
        orgId,
      },
      {
        streamMode: 'values',
        version: 'v2',
        // Callbacks propagate to every child run — one handler meters all
        // LLM calls of the graph (hook, content, categories, ...).
        callbacks: [
          new AiUsageCallbackHandler({
            organizationId: orgId,
            engine: 'generate-posts',
            model: 'gpt-4.1',
          }),
        ],
      }
    );
  }

  /** The run as the modal needs it: each step as it starts, then the posts. */
  async *run(orgId: string, body: GeneratorDto): AsyncGenerator<GeneratorLine> {
    const output: Record<string, unknown> = {};
    let step = '';
    for await (const event of this.start(orgId, body)) {
      // A node's own run is named after the node; the prompt and the model
      // inside it carry the node only in their metadata.
      if (event.metadata?.langgraph_node !== event.name) {
        continue;
      }
      if (event.event === 'on_chain_start') {
        if (GENERATOR_STEPS.has(event.name) && event.name !== step) {
          step = event.name;
          yield { name: step };
        }
        continue;
      }
      if (event.event === 'on_chain_end') {
        const update = event.data?.output;
        if (update && typeof update === 'object' && !Array.isArray(update)) {
          for (const key of ['hook', 'content', 'date', 'imagesSkipped']) {
            if (key in update) {
              output[key] = (update as Record<string, unknown>)[key];
            }
          }
        }
      }
    }
    yield { name: 'done', data: { output } };
  }
}
