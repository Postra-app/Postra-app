import { HttpException } from '@nestjs/common';
import { RunnableLambda } from '@langchain/core/runnables';

// The real graph, with the model, the database and storage stood in for.
const asked: string[] = [];
jest.mock('@langchain/openai', () => ({
  ChatOpenAI: class {
    bindTools() {
      return RunnableLambda.from(async () => {
        asked.push('agent');
        return { content: 'x' };
      });
    }
    withStructuredOutput(schema: any) {
      const keys = Object.keys(schema.shape);
      return RunnableLambda.from(async () => {
        asked.push(keys[0]);
        if (keys[0] === 'hook') return { hook: 'A hook' };
        if (keys[0] === 'category') return { category: 'c' };
        if (keys[0] === 'topic') return { topic: 't' };
        const item = { content: 'Body', website: null, prompt: 'a picture' };
        return { content: schema.shape.content.type === 'array' ? [item, item] : item };
      });
    }
  },
}));
jest.mock('@langchain/tavily', () => ({ TavilySearch: class {} }));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ uploadSimple: async () => 'https://cdn.test/p.png' }) },
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/posts/posts.service', () => ({ PostsService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/media/media.service', () => ({ MediaService: class {} }));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({ OpenaiService: class {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service', () => ({
  SubscriptionService: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/brand-kit/brand-kit.service', () => ({
  BrandKitService: class {},
}));

import { AgentGraphService } from '@gitroom/nestjs-libraries/agent/agent.graph.service';

const PNG = `data:image/png;base64,${'A'.repeat(50_000)}`;

const service = (over: { categories?: { category: string }[]; credit?: () => Promise<string> } = {}) =>
  new AgentGraphService(
    {
      findAllExistingCategories: async () => over.categories ?? [],
      findAllExistingTopicsOfCategory: async () => [{ topic: 't' }],
      findPopularPosts: async () => [{ content: 'c', hook: 'h' }],
      findFreeDateTime: async () => '2026-11-20T10:00:00',
    } as any,
    { saveFile: async () => ({ id: 'm1', path: 'https://cdn.test/p.png' }) } as any,
    { generateImage: async () => PNG } as any,
    { useCreditByOrgId: (_o: string, _t: string, fn: () => Promise<string>) => (over.credit ? over.credit() : fn()) } as any,
    { getNormalized: async (): Promise<null> => null } as any
  );

const run = async (svc: AgentGraphService, body: any) => {
  const lines: any[] = [];
  for await (const line of svc.run('org1', body)) lines.push(line);
  return lines;
};

describe('the post Creator run', () => {
  beforeEach(() => (asked.length = 0));

  // Production has no search key and no popular posts: two of the four model
  // calls of every run asked for nothing (a "research" answer that was thrown
  // away, a category out of an empty list).
  it('without a search tool or categories asks the model only for the hook and the content', async () => {
    const lines = await run(service(), { research: 'Five tips', isPicture: false, format: 'one_short', tone: 'company' });
    expect(asked).toEqual(['hook', 'content']);
    expect(lines.map((l) => l.name)).toEqual([
      'find-category',
      'find-topic',
      'find-popular-posts',
      'generate-hook',
      'generate-content',
      'post-time',
      'done',
    ]);
    expect(lines.at(-1).data.output).toEqual({
      hook: 'A hook',
      content: [{ content: 'Body', website: null, prompt: 'a picture' }],
      date: '2026-11-20T10:00:00',
    });
  });

  it('with categories in the table still classifies', async () => {
    await run(service({ categories: [{ category: 'c' }] }), {
      research: 'Five tips',
      isPicture: false,
      format: 'one_short',
      tone: 'company',
    });
    expect(asked).toEqual(['category', 'topic', 'hook', 'content']);
  });

  // The graph's own events carried the whole state on every step: each
  // picture as base64, several times, to a modal that reads a step name.
  it('sends the browser step names and the saved pictures, never the image bytes', async () => {
    const lines = await run(service(), { research: 'Five tips', isPicture: true, format: 'thread_short', tone: 'personal' });
    const sent = JSON.stringify(lines);
    expect(sent).not.toContain('base64');
    expect(sent.length).toBeLessThan(2_000);
    expect(lines.map((l) => l.name)).toEqual(expect.arrayContaining(['generate-picture', 'upload-pictures']));
    const { content, imagesSkipped } = lines.at(-1).data.output;
    expect(content).toHaveLength(2);
    expect(content[0].image).toEqual({ id: 'm1', path: 'https://cdn.test/p.png' });
    expect(imagesSkipped).toBeUndefined();
  });

  // It threw, which cut the stream: the written posts were lost with it.
  it('out of image credits: the posts come back without pictures, and say why', async () => {
    const lines = await run(
      service({ credit: () => Promise.reject(new HttpException('No credits', 402)) }),
      { research: 'Five tips', isPicture: true, format: 'thread_short', tone: 'personal' }
    );
    const { content, imagesSkipped, hook } = lines.at(-1).data.output;
    expect(hook).toBe('A hook');
    expect(content.map((c: any) => c.content)).toEqual(['Body', 'Body']);
    expect(content.every((c: any) => !c.image)).toBe(true);
    expect(imagesSkipped).toBe('credits');
  });

  it('the image model failing: the posts come back, marked "failed"', async () => {
    const lines = await run(service({ credit: () => Promise.reject(new Error('boom')) }), {
      research: 'Five tips',
      isPicture: true,
      format: 'one_long',
      tone: 'company',
    });
    expect(lines.at(-1).data.output.imagesSkipped).toBe('failed');
    expect(lines.at(-1).data.output.content).toHaveLength(1);
  });
});
