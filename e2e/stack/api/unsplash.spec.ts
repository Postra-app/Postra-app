import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Unsplash as the second free photo library next to Pixabay (K. 2026-10-08,
// Pexels stopped issuing keys). Its API terms: credit the photographer and
// Unsplash, and report every download to /photos/:id/download. The fake
// answers in fake-mastodon.mjs.

const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('an Unsplash photo comes with its credit, and importing it reports the download', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const sources = await (await org.api.get('/media/stock-sources')).json();
    expect(sources).toMatchObject({ unsplash: true });

    const query = `sourdough ${Date.now()}`;
    const search = await org.api.get(`/media/unsplash-images?q=${encodeURIComponent(query)}`);
    expect(search.status(), await search.text()).toBe(200);
    const { hits } = await search.json();
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      id: 'StackUnspl1',
      user: 'Stack Lens',
      alt: `${query} on a wooden table`,
    });
    // Unsplash wants a referral back on both links.
    expect(hits[0].userURL).toBe('https://unsplash.com/@stacklens?utm_source=postra&utm_medium=referral');
    expect(hits[0].pageURL).toBe('https://unsplash.com/photos/StackUnspl1?utm_source=postra&utm_medium=referral');
    expect(JSON.stringify(hits)).not.toContain('stack-fake-unsplash');

    const before = (await (await org.api.get('http://localhost:58080/__unsplash/downloads')).json()).length;
    const imported = await org.api.post('/media/unsplash-images/import', {
      data: { url: hits[0].importURL, sourceId: hits[0].id, downloadLocation: hits[0].downloadLocation },
    });
    expect(imported.status(), await imported.text()).toBe(201);
    const media = await prisma.media.findUniqueOrThrow({ where: { id: (await imported.json()).id } });
    expect(media.organizationId).toBe(org.orgId);
    expect(media.originalName).toBe('unsplash-StackUnspl1');
    const downloads = await (await org.api.get('http://localhost:58080/__unsplash/downloads')).json();
    expect(downloads.length).toBe(before + 1);
    expect(downloads.at(-1)).toBe('StackUnspl1');
  } finally {
    await org.remove();
  }
});

test('an Unsplash import from anywhere but Unsplash is refused, and the download report never follows a client address', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    for (const url of ['https://example.com/x.jpg', 'http://169.254.169.254/', 'https://images.unsplash.com.evil.test/x.jpg']) {
      expect((await org.api.post('/media/unsplash-images/import', { data: { url } })).status(), url).toBe(400);
    }
    // The download report goes to Unsplash's API for the photo's id, never
    // to an address the client sends (CodeQL on #350).
    const before = (await (await org.api.get('http://localhost:58080/__unsplash/downloads')).json()).length;
    const res = await org.api.post('/media/unsplash-images/import', {
      data: {
        url: 'http://localhost:58080/__pexels/photo.png',
        sourceId: 'StackUnspl1',
        downloadLocation: 'http://169.254.169.254/latest/meta-data',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    const downloads = await (await org.api.get('http://localhost:58080/__unsplash/downloads')).json();
    expect(downloads.slice(before)).toEqual(['StackUnspl1']);
    // No photo id, nothing to report: refused.
    expect(
      (await org.api.post('/media/unsplash-images/import', { data: { url: 'http://localhost:58080/__pexels/photo.png', sourceId: '../me' } })).status()
    ).toBe(400);
  } finally {
    await org.remove();
  }
});
