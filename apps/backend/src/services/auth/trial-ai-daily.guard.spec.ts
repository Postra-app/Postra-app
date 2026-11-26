import { readFileSync } from 'fs';
import { join } from 'path';
import { TrialAiDailyGuard, withinTrialDay } from './trial-ai-daily.guard';
import { TRIAL_AI_ACTIONS_PER_DAY, TRIAL_AUTOCOMPLETE_PER_DAY } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// The AI that writes and edits (rewrite, chat, hashtags, alt text, captions,
// retouch...) draws on no allowance, unlike images, videos and the
// assistant: a script on a trial without a card could run it all day. A
// trial has a daily number of these actions; a paid plan has none.
const ctx = (org: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ org }) }) }) as any;
let n = 0;
const trialOrg = () => ({ id: `org-ai-${Date.now()}-${++n}`, isTrailing: true });

describe('the daily AI actions of a trial', () => {
  it('is 100 a day', () => {
    expect(TRIAL_AI_ACTIONS_PER_DAY).toBe(100);
  });

  it('lets a trial use 100 in a day, and refuses the 101st with the trial wording', async () => {
    const guard = new TrialAiDailyGuard();
    const org = trialOrg();
    for (let i = 0; i < TRIAL_AI_ACTIONS_PER_DAY; i++) {
      await expect(guard.canActivate(ctx(org))).resolves.toBe(true);
    }
    const refused = await guard.canActivate(ctx(org)).catch((e) => e);
    expect(refused.getStatus()).toBe(402);
    expect(refused.getResponse()).toEqual({
      statusCode: 402,
      trial: true,
      message:
        "Your free trial includes 100 AI actions a day (writing, hashtags, captions, retouch), and today's are used. They start again tomorrow; your plan has no daily limit. End the trial to start your plan now.",
    });
  });

  it('counts each organisation on its own', async () => {
    const guard = new TrialAiDailyGuard();
    const a = trialOrg();
    for (let i = 0; i < TRIAL_AI_ACTIONS_PER_DAY; i++) await guard.canActivate(ctx(a));
    await expect(guard.canActivate(ctx(trialOrg()))).resolves.toBe(true);
  });

  it('a paid plan is not counted', async () => {
    const guard = new TrialAiDailyGuard();
    const org = { id: `org-paid-${Date.now()}`, isTrailing: false };
    for (let i = 0; i < TRIAL_AI_ACTIONS_PER_DAY + 5; i++) {
      await expect(guard.canActivate(ctx(org))).resolves.toBe(true);
    }
  });

  // Read as source, like media.controller.ai-gates.spec.ts: the decorator is
  // what ships.
  it.each([
    ['media.controller.ts', ['/ai-edit', '/ai-chat', '/suggest-hashtags', '/:id/alt-text', '/brand-voice-check', '/refine-design', '/:id/retouch', '/:id/auto-caption', '/remove-background']],
    ['posts.controller.ts', ['/generator', '/separate-posts']],
  ])('%s: every AI route without an allowance has the daily guard', (file, routes) => {
    const source = readFileSync(join(__dirname, '../../api/routes', file), 'utf8');
    for (const route of routes) {
      const at = source.indexOf(`@Post('${route}')`);
      expect(at).toBeGreaterThan(-1);
      // The decorators: from the route to the method's own line.
      const rest = source.slice(at);
      const decorators = rest.slice(0, rest.search(/\n  (async )?[a-zA-Z]+\(/));
      expect(`${route}: ${decorators}`).toContain('TrialAiDailyGuard');
    }
  });

  // Suggestions while typing: their own 300 a day, and past it no suggestion
  // rather than a dialog in the middle of typing.
  it('counts suggestions while typing on their own, 300 a day', async () => {
    expect(TRIAL_AUTOCOMPLETE_PER_DAY).toBe(300);
    const org = trialOrg();
    for (let i = 0; i < TRIAL_AUTOCOMPLETE_PER_DAY; i++) {
      expect(await withinTrialDay(org, 'autocomplete', TRIAL_AUTOCOMPLETE_PER_DAY)).toBe(true);
    }
    expect(await withinTrialDay(org, 'autocomplete', TRIAL_AUTOCOMPLETE_PER_DAY)).toBe(false);
    // The other AI actions are untouched.
    await expect(new TrialAiDailyGuard().canActivate(ctx(org))).resolves.toBe(true);
  });

  it('the editor gets no suggestion past the day, not an error', () => {
    const source = readFileSync(join(__dirname, '../../api/routes/copilot.controller.ts'), 'utf8');
    const route = source.slice(source.indexOf("@Post('/autocomplete')"));
    expect(route.slice(0, route.indexOf('try {'))).toMatch(/withinTrialDay\(\s*organization,\s*'autocomplete',\s*TRIAL_AUTOCOMPLETE_PER_DAY\s*\)[\s\S]*return \{ suggestion: '' \}/);
  });
});
