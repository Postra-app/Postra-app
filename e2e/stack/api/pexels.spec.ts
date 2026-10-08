import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Pexels as a second free stock library next to Pixabay (K. 2026-10-08):
// search through our API (the key stays on the server), import into the media
// library (no hotlinking), and the photographer's name comes along for the
// credit Pexels asks for. The fake answers in fake-mastodon.mjs.

const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('a Pexels photo is found with its credit and imported into the library', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const search = await org.api.get('/media/pexels-images?q=carrot cake');
    expect(search.status(), await search.text()).toBe(200);
    const { hits } = await search.json();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 1001,
      user: 'Stack Photographer',
      userURL: 'https://www.pexels.com/@stack',
      pageURL: 'https://www.pexels.com/photo/stack-cake-1001/',
      alt: 'A carrot cake on a table',
    });
    // The key went to Pexels from the server, never to the browser.
    const seen = await (await org.api.get('http://localhost:58080/__pexels/seen')).json();
    expect(seen.at(-1)).toMatchObject({ path: '/pexels/v1/search', query: 'carrot cake', auth: 'stack-fake-pexels' });
    expect(JSON.stringify(hits)).not.toContain('stack-fake-pexels');

    const imported = await org.api.post('/media/pexels-images/import', {
      data: { url: hits[0].importURL, sourceId: hits[0].id },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const media = await prisma.media.findUniqueOrThrow({ where: { id: (await imported.json()).id } });
    expect(media.organizationId).toBe(org.orgId);
    expect(media.name).toBe('pexels-1001');
  } finally {
    await org.remove();
  }
});

test('a Pexels video is found and imported as an MP4', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const { hits } = await (await org.api.get('/media/pexels-videos?q=harbour')).json();
    expect(hits[0]).toMatchObject({ id: 2002, user: 'Stack Filmmaker', duration: 8 });
    const imported = await org.api.post('/media/pexels-videos/import', {
      data: { url: hits[0].importURL, sourceId: hits[0].id },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    expect((await imported.json()).path).toMatch(/\.mp4$/);
  } finally {
    await org.remove();
  }
});

test('an import from anywhere but Pexels is refused', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    for (const url of ['https://example.com/x.jpg', 'http://169.254.169.254/latest/meta-data', 'https://images.pexels.com.evil.test/x.jpg']) {
      const res = await org.api.post('/media/pexels-images/import', { data: { url } });
      expect(res.status(), url).toBe(400);
    }
  } finally {
    await org.remove();
  }
});
