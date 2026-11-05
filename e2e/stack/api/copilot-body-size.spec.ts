import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { anonymous, database, throwawayOrg } from '../helpers';

// The AI runtime validates the whole agent/run body with zod, which keeps one
// issue object per failing array element: a few MB of `[1,1,1,...]` cost the
// backend process over a GB of memory, and the 25 MB JSON limit the Studio
// routes need was enough to run it out of memory with one request. The chat
// sends images as URLs, so its bodies stay small: anything over the copilot
// limit is refused by the JSON parser before the runtime sees it.

const prisma = database();
let org: Awaited<ReturnType<typeof throwawayOrg>>;

test.beforeAll(async () => {
  org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
});
test.afterAll(async () => {
  await org.remove();
  await prisma.$disconnect();
});

// agent/run envelope whose message list is `count` bare numbers: every
// element fails the message schema.
const hugeRun = (count: number) =>
  `{"method":"agent/run","params":{"agentId":"postra"},"body":{"threadId":"${randomUUID()}","runId":"${randomUUID()}","tools":[],"context":[],"state":{},"forwardedProps":{},"messages":[${Array(count).fill('1').join(',')}]}}`;

for (const route of ['/copilot/chat', '/copilot/agent']) {
  test(`${route}: a 3 MB body is 413 and the backend keeps answering`, async () => {
    const body = hugeRun(1_500_000);
    expect(body.length).toBeGreaterThan(3_000_000);
    const res = await org.api.post(route, {
      data: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(413);

    const live = await (await anonymous()).get('/monitor/live');
    expect(live.status()).toBe(200);
  });
}

test('/copilot/agent: an ordinary run body still reaches the runtime', async () => {
  const res = await org.api.post('/copilot/agent', {
    data: { method: 'info' },
  });
  expect(res.status()).toBe(200);
});
