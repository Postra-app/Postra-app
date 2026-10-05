import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// Inputs a client gets wrong answered 500 (and a Sentry issue) instead of
// telling the client what was wrong: POSTS-13, API-11…14, BILL-11.
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
      ['POSTS-13 value as an object', () => org.api.post('/posts', { data: draft([{ integration: { id: channel }, value: {}, settings: { __type: 'bluesky' } }]) })],
      ['API-12 posts as an object', () => publicApi.post('posts', { data: draft({}) })],
      ['API-11 canvas of an unknown medium', () => org.api.put(`/media/${unknown}/canvas`, { data: { canvasJson: '{}' } })],
      ['API-13 upload without a file', () => org.api.post('/media/upload-simple', { multipart: { other: 'x' } })],
      ['API-14 unknown third-party provider', () => org.api.post('/third-party/not-a-provider', { data: { api: 'x' } })],
      ['BILL-11 a lifetime code for a paying org', () => org.api.post('/billing/lifetime', { data: { code: 'x' } })],
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
