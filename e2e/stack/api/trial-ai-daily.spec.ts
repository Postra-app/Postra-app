import { expect, test } from '@playwright/test';
import Redis from 'ioredis';
import { database, throwawayOrg } from '../helpers';
import {
  TRIAL_AI_ACTIONS_PER_DAY,
  TRIAL_AUTOCOMPLETE_PER_DAY,
} from '../../../libraries/nestjs-libraries/src/database/prisma/subscriptions/pricing';

// The AI that writes and edits has no allowance of its own; on a trial it has
// a number a day. The day's count is set in Redis here: the routes are rate
// limited to 30 in 5 minutes, so the hundredth cannot be reached by calling.
const prisma = database();
const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:56379');
const orgs: { remove: () => Promise<void> }[] = [];
test.afterAll(async () => {
  for (const o of orgs) await o.remove();
  redis.disconnect();
  await prisma.$disconnect();
});
const today = () => new Date().toISOString().slice(0, 10);
const edit = { data: { text: 'Fresh bread every morning at our bakery.', action: 'shorten', platform: 'bluesky' } };

test('a trial past its AI actions for the day is told so, with the trial wording; a paid plan is not counted', async () => {
  const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0, isTrailing: true });
  const paid = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0 });
  orgs.push(trial, paid);

  await redis.set(`trial-ai:${trial.orgId}:${today()}`, TRIAL_AI_ACTIONS_PER_DAY - 1, 'EX', 3600);
  expect((await trial.api.post('/media/ai-edit', edit)).status()).toBe(201);
  const refused = await trial.api.post('/media/ai-edit', edit);
  expect(refused.status()).toBe(402);
  expect(await refused.json()).toMatchObject({
    trial: true,
    message: expect.stringContaining('Your free trial includes 100 AI actions a day'),
  });
  // Every route of the kind shares the count.
  expect((await trial.api.post('/media/suggest-hashtags', { data: { text: 'Bakery news', platform: 'instagram' } })).status()).toBe(402);

  await redis.set(`trial-ai:${paid.orgId}:${today()}`, 10_000, 'EX', 3600);
  expect((await paid.api.post('/media/ai-edit', edit)).status()).toBe(201);
});

test('suggestions while typing stop quietly past the trial\'s day', async () => {
  const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 8, channels: 0, isTrailing: true });
  orgs.push(trial);
  await redis.set(`trial-autocomplete:${trial.orgId}:${today()}`, TRIAL_AUTOCOMPLETE_PER_DAY, 'EX', 3600);
  const res = await trial.api.post('/copilot/autocomplete', { data: { surface: 'post', before: 'Fresh bread every' } });
  expect(res.status(), await res.text()).toBe(201);
  expect(await res.json()).toEqual({ suggestion: '' });
});
