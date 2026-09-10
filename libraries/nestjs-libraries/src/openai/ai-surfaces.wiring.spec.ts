import { readFileSync } from 'fs';
import { join } from 'path';

// The Brand Kit and the usage log both depend on wiring that lives at the call
// site, and a new AI surface is exactly where that wiring gets forgotten — the
// agent's image tool was the only place reading the kit for months, and images
// were the one model call nobody metered.
//
// Read as source rather than imported: MediaService drags SubscriptionService
// and the whole integration manager into the test run and never starts.

const ROOT = join(__dirname, '..');
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8');

const IMAGE_CALL_SITES = [
  'database/prisma/media/media.service.ts',
  'database/prisma/autopost/autopost.service.ts',
  'agent/agent.graph.service.ts',
];

const callsToGenerateImage = (source: string): string[] => {
  const out: string[] = [];
  const marker = /_open[aA]i[sS]?[a-zA-Z]*\.generateImage\(/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(source))) {
    out.push(source.slice(match.index, match.index + 320));
  }
  return out;
};

describe('every image call says who it is for', () => {
  it.each(IMAGE_CALL_SITES)('%s meters its images', (file) => {
    const calls = callsToGenerateImage(read(file));
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // `engine` may travel as a shorthand property, forwarded from the caller
      expect(call).toMatch(/engine\s*[:,}]/);
      expect(call).toMatch(/orgId|organizationId/);
    }
  });
});

describe('media a model produced is recorded as such', () => {
  // The flag can only be set where the file is created; nothing downstream can
  // tell afterwards, because every render path strips the model's C2PA marker.
  it.each([
    ['database/prisma/media/media.service.ts', 2],
    ['chat/tools/generate.image.tool.ts', 1],
    ['agent/agent.graph.service.ts', 1],
  ])('%s flags what it generates', (file, expected) => {
    const source = read(file);
    const flagged = source.match(/saveFile\(([^;]*?)true\s*\)/gs) ?? [];
    expect(flagged.length).toBe(expected);
  });

  it('the composer route flags the image it just generated', () => {
    const controller = readFileSync(
      join(__dirname, '../../../../apps/backend/src/api/routes/media.controller.ts'),
      'utf8'
    );
    const route = controller.slice(
      controller.indexOf("@Post('/generate-image-with-prompt')"),
      controller.indexOf("@Post('/generate-post-design')")
    );
    expect(route).toMatch(/saveFile\([\s\S]*?true\s*\)/);
  });
});

describe('brand guidance comes from one place', () => {
  it('applies the kit to every raw AI image, in MediaService', () => {
    const media = read('database/prisma/media/media.service.ts');
    expect(media).toContain('buildBrandContext');
    // the block is appended after the prompt expander rewrites the prompt
    expect(media).toMatch(/generatePromptForPicture[\s\S]{0,400}\$\{brand\}/);
  });

  it('loads the kit once per run in the Creator and in AutoPost', () => {
    for (const file of [
      'agent/agent.graph.service.ts',
      'database/prisma/autopost/autopost.service.ts',
    ]) {
      const source = read(file);
      expect(source).toContain("addNode('load-brand'");
      expect(source).toContain("addEdge(START, 'load-brand')");
      expect(source).toContain('buildBrandContext');
    }
  });

  it('leaves no surface writing its own language rule', () => {
    const surfaces = [
      'database/prisma/media/media.service.ts',
      'database/prisma/autopost/autopost.service.ts',
      'agent/agent.graph.service.ts',
      'chat/load.tools.service.ts',
      'studio/studio-ai.service.ts',
      'openai/openai.service.ts',
    ];
    for (const file of surfaces) {
      const source = read(file);
      expect(source).not.toMatch(/simple english/i);
      // "the same language as X" is the rule's own wording; a surface
      // repeating it inline is a second rule waiting to drift.
      expect(source).not.toMatch(/SAME language as/);
    }
  });

  it('leaves no surface assembling brand text of its own', () => {
    const surfaces = [
      ...IMAGE_CALL_SITES,
      'chat/tools/generate.image.tool.ts',
      'chat/load.tools.service.ts',
      'studio/studio-ai.service.ts',
    ];
    for (const file of surfaces) {
      const source = read(file);
      expect(source).not.toMatch(/Brand tone of voice:/);
      expect(source).not.toMatch(/Visual brand style:/);
    }
  });
});
