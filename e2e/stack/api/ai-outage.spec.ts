import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// OpenAI down (fake-openai.mjs /__outage: every call carrying OUTAGE answers
// 500, after the SDK's own retries). The user must get a "try again later" they can act on — not a 500,
// not an empty 201 — and must not pay an AI image credit for nothing.

const FAKE = 'http://localhost:58090';
const OUTAGE = 'stack-openai-outage-probe';
const prisma = database();
let org: Awaited<ReturnType<typeof throwawayOrg>>;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  await org.api.post(`${FAKE}/__outage`, { data: { match: OUTAGE, on: true } });
});
test.afterAll(async () => {
  await org.api.post(`${FAKE}/__outage`, { data: { match: OUTAGE, on: false } });
  await org.remove();
  await prisma.$disconnect();
});

const imagesLeft = async () =>
  (await (await org.api.get('/copilot/credits?type=ai_images')).json()).credits as number;

const TEXT = `${OUTAGE}: Postra lets small agencies plan, write and publish social posts for every client.`;

for (const [name, path, data] of [
  ['composer "Shorten"', '/media/ai-edit', { text: TEXT, action: 'shorten', platform: 'bluesky' }],
  ['hashtag suggestions', '/media/suggest-hashtags', { text: TEXT, platform: 'instagram' }],
  ['Studio AI Generate', '/media/generate-post-design', { prompt: `${OUTAGE} autumn coffee offer`, platform: 'instagram-feed' }],
  ['composer AI image', '/media/generate-image-with-prompt', { prompt: `${OUTAGE} a cup of coffee` }],
] as const) {
  test(`${name}: 503 with a message while OpenAI is down`, async () => {
    test.setTimeout(90_000);
    const before = await imagesLeft();
    const res = await org.api.post(path, { data });
    expect(res.status(), await res.text()).toBe(503);
    expect((await res.json()).message).toMatch(/AI is unavailable/i);
    expect(await imagesLeft()).toBe(before);
  });
}
