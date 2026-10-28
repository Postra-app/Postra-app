import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Inputs a client gets wrong answered 500 (and a Sentry issue) instead of
// telling the client what was wrong. One of them, /billing/lifetime, is gone.
test('malformed requests are 4xx, not 500', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 1 });
  try {
    const [channel] = org.channelIds;
    const key = (await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } })).apiKey!;
    const publicApi = await pwRequest.newContext({
      baseURL: `${BACKEND_URL}/public/v1/`,
      extraHTTPHeaders: { authorization: key },
    });
    const unknown = '00000000-0000-4000-8000-000000000000';
    const draft = (posts: unknown) => ({ type: 'draft', shortLink: false, date: new Date(Date.now() + 86_400_000).toISOString(), tags: [], posts });
    const cases: [string, () => Promise<{ status(): number }>][] = [
      ['value as an object', () => org.api.post('/posts', { data: draft([{ integration: { id: channel }, value: {}, settings: { __type: 'bluesky' } }]) })],
      ['posts as an object', () => publicApi.post('posts', { data: draft({}) })],
      ['canvas of an unknown medium', () => org.api.put(`/media/${unknown}/canvas`, { data: { canvasJson: '{}' } })],
      ['upload without a file', () => org.api.post('/media/upload-simple', { multipart: { other: 'x' } })],
      ['unknown third-party provider', () => org.api.post('/third-party/not-a-provider', { data: { api: 'x' } })],
    ];
    const results: string[] = [];
    for (const [name, call] of cases) {
      const status = (await call()).status();
      results.push(`${name}: ${status}`);
    }
    await publicApi.dispose();
    expect(results.filter((r) => /: 5\d\d$/.test(r))).toEqual([]);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
