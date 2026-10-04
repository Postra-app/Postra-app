import { APIRequestContext, expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  type Channel,
  channels,
  findPosts,
  type Media,
  onPlatform,
  PROMO,
  publishValues,
  stored,
  type Value,
  waitPublished,
} from './publish.helpers';

// Text of the HTML the composer stores; repeated until nothing is left to
// strip, so "<scr<b>ipt>" cannot leave a tag behind.
const stripTags = (html: string) => {
  let text = html;
  for (let prev = ''; prev !== text; ) {
    prev = text;
    text = text.replace(/<[^>]*>/g, '');
  }
  return text;
};

// The per-provider publishing matrix (e2e/05-composer-publish.md §5.3) on the
// technical channels only: Telegram, Discord, Mastodon, Bluesky. Manual, not
// nightly — it publishes about 16 real posts:
//
//   MATRIX_MEDIA=<dir with postra-matrix-1..4.png and postra-matrix.mp4> \
//   pnpm exec playwright test -c e2e/playwright --project setup --project publish-matrix
//
// The posts stay and read as Postra ads (Krzysztof, 2026-10-01). Postra's
// public profiles are never touched.

const run = new Date().toISOString().slice(0, 16) + 'Z';
const ad = (n: number, tag: string) => `${PROMO[n % PROMO.length]} · matrix ${run} ${tag}`;
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Uploaded = Media & { alt?: string };
const media: { images: Uploaded[]; video?: Uploaded } = { images: [] };

const upload = async (api: APIRequestContext, file: string, mimeType: string): Promise<Uploaded> => {
  const dir = process.env.MATRIX_MEDIA;
  expect(dir, 'MATRIX_MEDIA points at the test media').toBeTruthy();
  const res = await api.post('/api/media/upload-simple', {
    multipart: { file: { name: file, mimeType, buffer: readFileSync(`${dir}/${file}`) } },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  const { id, path } = await res.json();
  return { id, path };
};

const only = async (api: APIRequestContext, identifier: string): Promise<Channel[]> => {
  const list = (await channels(api)).filter((c) => c.identifier === identifier);
  expect(list.length, `${identifier} connected`).toBeGreaterThan(0);
  return list;
};

// Publish, then check every channel got exactly one post that went out, read it
// back from the platform where it has a public API, and check the replies.
const check = async (
  api: APIRequestContext,
  targets: Channel[],
  values: Value[],
  readBack: string,
  timeout = 240_000
) => {
  await publishValues(api, targets, values);
  const ids = await findPosts(api, stripTags(values[0].content).slice(-40));
  expect(ids.length, 'one post per channel').toBe(targets.length);
  const published = await waitPublished(api, ids, timeout);
  const urls: string[] = [];
  for (const post of published) {
    expect(post.error, `error of ${post.id}`).toBeFalsy();
    expect(post.releaseURL, `release URL of ${post.id}`).toBeTruthy();
    const how = await onPlatform(api, post.releaseURL!, readBack);
    urls.push(`${post.releaseURL} (${how})`);
    if (values.length > 1) {
      // The rest of the value list went out as comments/replies of this post.
      await expect
        .poll(
          async () => {
            const all = (await (await api.get(`/api/posts/${post.id}`)).json()).posts as {
              id: string;
              state: string;
              error: string | null;
              releaseURL: string | null;
            }[];
            const replies = all.slice(1);
            const failed = replies.find((r) => r.state === 'ERROR');
            if (failed) throw new Error(`reply failed: ${failed.error}`);
            return replies.length === values.length - 1 && replies.every((r) => r.state === 'PUBLISHED');
          },
          { timeout, intervals: [3_000, 5_000] }
        )
        .toBe(true);
      const all = (await (await api.get(`/api/posts/${post.id}`)).json()).posts;
      for (const reply of all.slice(1)) urls.push(`reply ${reply.releaseURL || '(no URL)'}`);
    }
  }
  test.info().annotations.push({ type: 'published', description: urls.join(' | ') });
  return published;
};


test.beforeAll(async ({ request }) => {
  for (let i = 1; i <= 4; i++) {
    media.images.push({
      ...(await upload(request, `postra-matrix-${i}.png`, 'image/png')),
      alt: `Postra test image ${i}: a coloured square with a dark frame`,
    });
  }
  media.video = await upload(request, 'postra-matrix.mp4', 'video/mp4');
});

// ---- Telegram ------------------------------------------------------------

test('Telegram: text and one image', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(0, 'tg-image');
  await check(request, await only(request, 'telegram'), [{ content, image: media.images.slice(0, 1) }], content);
});

test('Telegram: short video', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(1, 'tg-video');
  await check(request, await only(request, 'telegram'), [{ content, image: [media.video!] }], content);
});

test('Telegram: three images as one album, bold and italic', async ({ request }) => {
  test.setTimeout(300_000);
  const tag = ad(2, 'tg-album');
  const content = `<p><strong>Postra</strong> — <em>one calendar for every channel.</em> ${tag}</p>`;
  await check(request, await only(request, 'telegram'), [{ content, image: media.images.slice(0, 3) }], tag);
});

test('Telegram: post with a reply', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(3, 'tg-reply');
  await check(
    request,
    await only(request, 'telegram'),
    [{ content }, { content: `Try it at postra.co.uk · reply ${run}` }],
    content
  );
});

// ---- Discord -------------------------------------------------------------

test('Discord: text and one image', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(4, 'dc-image');
  await check(request, await only(request, 'discord'), [{ content, image: media.images.slice(0, 1) }], content);
});

test('Discord: short video', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(5, 'dc-video');
  await check(request, await only(request, 'discord'), [{ content, image: [media.video!] }], content);
});

test('Discord: three images in one message (carousel)', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(5, 'dc-three');
  await check(request, await only(request, 'discord'), [{ content, image: media.images.slice(0, 3) }], content);
  await pause(5_000);
});

test('Discord: heading, list and link in markdown', async ({ request }) => {
  test.setTimeout(300_000);
  const tag = ad(6, 'dc-markdown');
  const content = `<h1>Meet Postra</h1><ul><li>One calendar for every channel</li><li>AI that writes in your voice</li></ul><p><a href="https://postra.co.uk">postra.co.uk</a> ${tag}</p>`;
  await check(request, await only(request, 'discord'), [{ content }], tag);
});

test('Discord: post with a thread reply', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(0, 'dc-thread');
  await check(
    request,
    await only(request, 'discord'),
    [{ content }, { content: `Questions? hello@postra.co.uk · thread ${run}` }],
    content
  );
});

// Every comment lives in the thread opened under the post; the second one used
// to land in the channel itself. A Discord thread started from a message has
// the message's id, so both replies' URLs must point at the post's id.
test('Discord: two comments both land in the post\'s thread', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(1, 'dc-thread2');
  const [post] = await check(
    request,
    (await only(request, 'discord')).slice(0, 1),
    [{ content }, { content: `Questions? hello@postra.co.uk · reply 1 ${run}` }, { content: `Try it: postra.co.uk · reply 2 ${run}` }],
    content
  );
  const postMessage = new URL(post.releaseURL!).pathname.split('/').pop();
  const all = (await (await request.get(`/api/posts/${post.id}`)).json()).posts as { releaseURL: string | null }[];
  const replyChannels = all.slice(1).map((r) => new URL(r.releaseURL!).pathname.split('/')[3]);
  expect(replyChannels).toEqual([postMessage, postMessage]);
});

// ---- Mastodon ------------------------------------------------------------

test('Mastodon: image with alt text', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(1, 'md-image');
  const [post] = await check(
    request,
    (await only(request, 'mastodon')).slice(0, 1),
    [{ content, image: media.images.slice(0, 1) }],
    content
  );
  const url = new URL(post.releaseURL!);
  const status = await (await request.get(`${url.origin}/api/v1/statuses/${url.pathname.split('/').pop()}`)).json();
  expect(status.media_attachments?.[0]?.description, 'alt text on Mastodon').toBe(media.images[0].alt);
  await pause(5_000);
});

test('Mastodon: short video', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(2, 'md-video');
  await check(request, (await only(request, 'mastodon')).slice(0, 1), [{ content, image: [media.video!] }], content);
  await pause(5_000);
});

test('Mastodon: four images with alt text (carousel)', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(3, 'md-four');
  const [post] = await check(request, (await only(request, 'mastodon')).slice(0, 1), [{ content, image: media.images }], content);
  const url = new URL(post.releaseURL!);
  const status = await (await request.get(`${url.origin}/api/v1/statuses/${url.pathname.split('/').pop()}`)).json();
  expect(status.media_attachments?.length, 'four images on Mastodon').toBe(4);
  expect(status.media_attachments.map((m: { description: string }) => m.description)).toEqual(media.images.map((i) => i.alt));
  await pause(5_000);
});

test('Mastodon: post with a reply in the thread', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(3, 'md-thread');
  const [post] = await check(
    request,
    (await only(request, 'mastodon')).slice(0, 1),
    [{ content }, { content: `Try it at postra.co.uk · reply ${run}` }],
    content
  );
  const reply = (await (await request.get(`/api/posts/${post.id}`)).json()).posts[1];
  const origin = new URL(post.releaseURL!).origin;
  const replyStatus = await (
    await request.get(`${origin}/api/v1/statuses/${new URL(reply.releaseURL).pathname.split('/').pop()}`)
  ).json();
  expect(replyStatus.in_reply_to_id, 'reply hangs under the post').toBe(new URL(post.releaseURL!).pathname.split('/').pop());
  await pause(5_000);
});

// ---- Bluesky -------------------------------------------------------------

const bskyRecord = async (api: APIRequestContext, releaseURL: string) => {
  const [, , actor, , rkey] = new URL(releaseURL).pathname.split('/');
  const did = actor.startsWith('did:')
    ? actor
    : (await (await api.get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${actor}`)).json()).did;
  const res = await api.get(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=at://${did}/app.bsky.feed.post/${rkey}`
  );
  expect(res.status()).toBe(200);
  return (await res.json()).thread;
};

test('Bluesky: one image with alt text', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(4, 'bs-image');
  const [post] = await check(request, (await only(request, 'bluesky')).slice(0, 1), [{ content, image: media.images.slice(0, 1) }], content);
  const thread = await bskyRecord(request, post.releaseURL!);
  expect(thread.post.record.embed?.images?.[0]?.alt, 'alt text on Bluesky').toBe(media.images[0].alt);
  await pause(5_000);
});

test('Bluesky: short video', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(5, 'bs-video');
  await check(request, (await only(request, 'bluesky')).slice(0, 1), [{ content, image: [media.video!] }], content);
  await pause(5_000);
});

test('Bluesky: four images with alt text', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(6, 'bs-four');
  const [post] = await check(request, (await only(request, 'bluesky')).slice(0, 1), [{ content, image: media.images }], content);
  const thread = await bskyRecord(request, post.releaseURL!);
  const images = thread.post.record.embed?.images || [];
  expect(images.length, 'four images on Bluesky').toBe(4);
  expect(images.map((i: { alt: string }) => i.alt)).toEqual(media.images.map((i) => i.alt));
  await pause(5_000);
});

test('Bluesky: post with a reply in the thread', async ({ request }) => {
  test.setTimeout(300_000);
  const content = ad(0, 'bs-thread');
  const [post] = await check(
    request,
    (await only(request, 'bluesky')).slice(0, 1),
    [{ content }, { content: `Try it at postra.co.uk · reply ${run}` }],
    content
  );
  // Read from the reply's side: the public thread view of the root may leave
  // the author's own reply out, the reply record itself names its parent.
  const reply = (await (await request.get(`/api/posts/${post.id}`)).json()).posts[1];
  const replyThread = await bskyRecord(request, reply.releaseURL);
  const rootUri = (await bskyRecord(request, post.releaseURL!)).post.uri;
  expect(replyThread.post.record.reply?.root?.uri, 'reply hangs under the post').toBe(rootUri);
  expect(replyThread.post.record.reply?.parent?.uri).toBe(rootUri);
});
