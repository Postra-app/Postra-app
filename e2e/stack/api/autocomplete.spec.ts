import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Ghost text in the signature, AutoPost and Plugs editors. CopilotKit's
// textarea stopped sending its own request (a stub since 1.60), so the
// editors ask POST /copilot/autocomplete; the surface picks the prompt on the
// server, and an OpenAI failure is no suggestion rather than an error.

const FAKE = 'http://localhost:58090';
const prisma = database();
let org: Awaited<ReturnType<typeof throwawayOrg>>;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => {
  org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
});
test.afterAll(async () => {
  await org.remove();
  await prisma.$disconnect();
});

test('suggests a continuation and records it as autocomplete', async () => {
  const res = await org.api.post('/copilot/autocomplete', {
    data: { surface: 'signature', before: 'Thanks for reading! Plan your next post with', after: '' },
  });
  expect(res.status(), await res.text()).toBe(201);
  expect((await res.json()).suggestion).toBe('Stack AI answer.');

  await expect
    .poll(() => prisma.aiUsage.count({ where: { organizationId: org.orgId, engine: 'autocomplete' } }))
    .toBe(1);
});

test('takes only the surfaces it knows, and no prompt of its own', async () => {
  for (const data of [
    { surface: 'anything', before: 'Hello' },
    { surface: 'post', before: 'x'.repeat(10_001) },
    { surface: 'post' },
  ]) {
    const res = await org.api.post('/copilot/autocomplete', { data });
    expect(res.status(), JSON.stringify(data).slice(0, 60)).toBe(400);
  }
});

test('OpenAI down: no suggestion, not an error in the editor', async () => {
  test.setTimeout(90_000);
  const marker = `stack-autocomplete-outage-${Date.now()}`;
  await org.api.post(`${FAKE}/__outage`, { data: { match: marker, on: true } });
  try {
    const res = await org.api.post('/copilot/autocomplete', {
      data: { surface: 'post', before: `${marker} Our autumn offer`, after: '' },
    });
    expect(res.status()).toBe(201);
    expect(await res.json()).toEqual({ suggestion: '' });
  } finally {
    await org.api.post(`${FAKE}/__outage`, { data: { match: marker, on: false } });
  }
});
