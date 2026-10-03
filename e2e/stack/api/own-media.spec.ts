import { expect, test } from '@playwright/test';
import { anonymous, channelOf, signedIn } from '../helpers';

// E2E-02-22: a post's media and the /public/stream proxy accept only our own
// storage — exact host, not "contains our domain somewhere".

const draftWith = (path: string) => ({
  type: 'draft',
  shortLink: false,
  date: new Date(Date.now() + 86_400_000).toISOString(),
  tags: [],
  posts: [
    {
      integration: { id: channelOf('a') },
      value: [{ content: '[stack] own media', image: [{ id: 'x', path }] }],
      settings: { __type: 'mastodon' },
    },
  ],
});

test('a post with an image from another host is refused', async () => {
  const api = await signedIn('a');
  for (const path of ['https://evil.example/a.png', `https://evil.example/${new URL(process.env.STACK_CDN || 'http://localhost').host}/a.png`]) {
    const res = await api.post('/posts', { data: draftWith(path) });
    expect(res.status(), path).toBe(400);
  }
  await api.dispose();
});

test('the stream proxy serves only our own media', async () => {
  const api = await anonymous();
  const res = await api.get('/public/stream?url=' + encodeURIComponent('https://evil.example/clip.mp4'));
  expect(res.status()).toBe(400);
  await api.dispose();
});
