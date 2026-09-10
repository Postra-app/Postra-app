import { readFileSync } from 'fs';
import { join } from 'path';

// Every route here reaches a model: OpenAI through StudioAi, DALL·E, Whisper,
// fal for video, or embeddings for template search. The client already hides
// these behind `user.tier.ai`; the server has to say no as well, or the gate is
// a suggestion.
//
// Read as source rather than imported: pulling MediaController into a test
// drags the whole integration manager with it. The decorator is what ships, so
// the decorator is what this checks.
const AI_ROUTES = [
  "/generate-video",
  "/generate-image",
  "/generate-image-with-prompt",
  "/generate-post-design",
  "/generate-carousel-design",
  "/:id/auto-caption",
  "/refine-design",
  "/brand-voice-check",
  "/:id/alt-text",
  "/suggest-hashtags",
  "/ai-edit",
  "/search-templates",
];

const source = readFileSync(
  join(__dirname, 'media.controller.ts'),
  'utf8'
);

const decoratorsAfterRoute = (path: string): string => {
  const start = source.indexOf(`@Post('${path}')`);
  if (start === -1) return '';
  const rest = source.slice(start);
  // decorators run until the method signature (first line that is not one)
  const lines = rest.split('\n').slice(1);
  const out: string[] = [];
  for (const line of lines) {
    if (!line.trim().startsWith('@')) break;
    out.push(line.trim());
  }
  return out.join('\n');
};

describe('media controller AI plan gates', () => {
  it.each(AI_ROUTES)('gates %s behind Sections.AI', (path) => {
    expect(source).toContain(`@Post('${path}')`);
    expect(decoratorsAfterRoute(path)).toContain(
      '@CheckPolicies([AuthorizationActions.Create, Sections.AI])'
    );
  });

  it('has no gate sitting anywhere else', () => {
    const gates = source.match(/@CheckPolicies\(/g)?.length ?? 0;
    expect(gates).toBe(AI_ROUTES.length);
  });

  it('leaves the routes that never call a model open', () => {
    // Burning captions is ffmpeg over an SRT the user already has, and the
    // "allowed" probe only answers whether a video type is offered. Charging a
    // plan gate for those would block work that costs us nothing.
    for (const path of ["/:id/burn-captions"]) {
      expect(decoratorsAfterRoute(path)).not.toContain('@CheckPolicies');
    }
  });
});
