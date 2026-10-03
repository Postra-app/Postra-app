import { expect, test } from '@playwright/test';
import {
  channels,
  findPosts,
  type Media,
  onPlatform,
  promo,
  publish,
  stored,
  TECHNICAL,
  waitPublished,
} from './publish.helpers';

// Real publishing, every night, on the five technical channels — Telegram ×2,
// Discord, Mastodon, Bluesky (Krzysztof's decision, 2026-10-01; the posts
// stay). Nothing here is faked: the post goes through production's API,
// Temporal and the providers to the real platforms, and where a platform has
// a public read API the test reads the post back from the platform itself.
// Postra's public profiles (Facebook, Instagram, LinkedIn, YouTube, X,
// Threads, TikTok) are never touched here.

test('"Post now" lands on every technical channel', async ({ request }) => {
  test.setTimeout(240_000);
  const targets = await channels(request);
  expect(targets.map((c) => c.identifier).sort(), 'technical channels connected').toEqual(
    expect.arrayContaining(TECHNICAL)
  );

  const content = promo();
  await publish(request, targets, content, 'now', new Date());
  const ids = await findPosts(request, content);
  expect(ids.length, 'one post per channel').toBe(targets.length);

  const published = await waitPublished(request, ids, 180_000);
  for (const post of published) {
    expect(post.releaseURL, `release URL of ${post.id}`).toBeTruthy();
    const how = await onPlatform(request, post.releaseURL!, content);
    test.info().annotations.push({ type: 'published', description: `${post.releaseURL} — ${how}` });
  }
});

test('a post scheduled two minutes ahead waits, then lands', async ({ request }) => {
  test.setTimeout(360_000);
  const mastodon = (await channels(request)).filter((c) => c.identifier === 'mastodon');
  expect(mastodon.length).toBeGreaterThan(0);

  const content = promo(1);
  const at = new Date(Date.now() + 120_000);
  await publish(request, mastodon.slice(0, 1), content, 'schedule', at);
  const [id] = await findPosts(request, content);
  expect((await stored(request, id)).state).toBe('QUEUE');

  const [post] = await waitPublished(request, [id], 300_000);
  expect(Date.now()).toBeGreaterThanOrEqual(at.getTime());
  await onPlatform(request, post.releaseURL!, content);
});

// The providers download the post's media from our CDN and upload it to the
// platform — the path that goes through the SSRF guard (U1). The image is the
// newest one in the test account's library.
test('a post with an image lands on Discord and Mastodon', async ({ request }) => {
  test.setTimeout(240_000);
  const res = await request.get('/api/media?page=1&type=image');
  expect(res.status()).toBe(200);
  const [image]: Media[] = (await res.json()).results;
  expect(image, 'an image in the media library').toBeTruthy();

  const targets = (await channels(request)).filter((c) =>
    ['discord', 'mastodon'].includes(c.identifier)
  );
  expect(targets.length).toBe(2);

  const content = promo(2);
  await publish(request, targets, content, 'now', new Date(), [
    { id: image.id, path: image.path },
  ]);
  const ids = await findPosts(request, content);
  const published = await waitPublished(request, ids, 180_000);
  for (const post of published) {
    await onPlatform(request, post.releaseURL!, content);
    test.info().annotations.push({ type: 'published with image', description: post.releaseURL! });
  }
});
