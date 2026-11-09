import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { database, stateFile } from '../helpers';
import { USERS } from '../seed';

// Both seen signed out, as a customer's client or
// a link checker sees them.

test.use({ storageState: { cookies: [], origins: [] } });

test('a deleted post behind a preview link says "Post not found" and shows nothing of it', async ({ page }) => {
  // HTTP 200 on purpose: (app)/loading.tsx streams the
  // page before it knows, and the host is closed to crawlers by robots.txt.
  const prisma = database();
  const channel = await prisma.integration.findUniqueOrThrow({ where: { id: USERS.a.channel.id } });
  const post = await prisma.post.create({
    data: {
      organizationId: channel.organizationId,
      integrationId: channel.id,
      group: `preview-gone-${Date.now()}`,
      content: '<p>Gone before the client looked.</p>',
      publishDate: new Date(Date.now() + 86_400_000),
      deletedAt: new Date(),
    },
  });
  try {
    await page.goto(`/p/${post.id}`);
    await expect(page.getByText('Post not found')).toBeVisible();
    await expect(page.getByText('Gone before the client looked')).toHaveCount(0);
  } finally {
    await prisma.post.delete({ where: { id: post.id } });
    await prisma.$disconnect();
  }
});

test('no page takes a session token from the address bar', async ({ request }) => {
  // /provider/* (upstream's mobile WebView bridge, unused by Postra's app)
  // signed in whoever opened it with ?loggedAuth=<jwt>; a token in a URL
  // ends up in history, referrers and access logs.
  const state = JSON.parse(readFileSync(stateFile('a'), 'utf8'));
  const jwt = state.cookies.find((c: any) => c.name === 'auth').value;
  for (const path of ['/provider/add', '/provider/bluesky']) {
    const res = await request.get(`${path}?loggedAuth=${jwt}`, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(new URL(res.headers()['location'], 'http://x').pathname, path).toBe('/auth');
  }
});
