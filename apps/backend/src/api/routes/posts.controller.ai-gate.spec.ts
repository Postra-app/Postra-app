import { readFileSync } from 'fs';
import { join } from 'path';

// The post generator runs five or more model calls per request (research,
// hooks, posts, pictures), yet it sat only behind the monthly post cap: an
// organisation whose plan has no AI could still run it. Every other route
// that reaches a model is behind Sections.AI (media.controller.ai-gates.spec).
// Read as source, like that spec: the decorator is what ships.
const source = readFileSync(join(__dirname, 'posts.controller.ts'), 'utf8');

const decoratorsAfterRoute = (path: string): string => {
  const start = source.indexOf(`@Post('${path}')`);
  if (start === -1) return '';
  // Decorators (one or several lines each) run until the method signature.
  const out: string[] = [];
  for (const line of source.slice(start).split('\n').slice(1)) {
    if (/^\s*(async\s+)?\w+\(\s*$/.test(line)) break;
    out.push(line.trim());
  }
  return out.join('\n');
};

describe('posts controller AI gate', () => {
  it('the generator needs the AI plan as well as room for posts', () => {
    const decorators = decoratorsAfterRoute('/generator');
    expect(decorators).toContain('Sections.POSTS_PER_MONTH');
    expect(decorators).toContain('[AuthorizationActions.Create, Sections.AI]');
  });

  it('saving the generated drafts calls no model and stays as it was', () => {
    expect(decoratorsAfterRoute('/generator/draft')).not.toContain('Sections.AI');
  });
});

// Third-party (HeyGen) is hidden in the menu but its routes answer: the
// voice script runs on our OpenAI key, so it needs the AI plan as well.
describe('third-party controller AI gate', () => {
  const tp = readFileSync(join(__dirname, 'third-party.controller.ts'), 'utf8');
  it.each(["'/:id/submit'", "'/function/:id/:functionName'"])(
    '%s is behind Sections.AI',
    (route) => {
      const start = tp.indexOf(`@Post(${route})`);
      expect(start).toBeGreaterThan(-1);
      const head = tp.slice(start, tp.indexOf('async ', start));
      expect(head).toContain('[AuthorizationActions.Create, Sections.AI]');
    }
  );
});
