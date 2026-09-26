/**
 * E2E-05-05 — X and Mastodon had no media check: 5 images, or an image with a
 * video, passed POST /posts/valid and failed at publish time (Mastodon on
 * production: "Cannot attach more than four files").
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { MastodonProvider } from '@gitroom/nestjs-libraries/integrations/social/mastodon.provider';

const img = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ path: `https://cdn/x${i}.jpg` }));
const video = { path: 'https://cdn/v.mp4' };
const gif = { path: 'https://cdn/g.gif' };

describe.each([
  ['X', new XProvider()],
  ['Mastodon', new MastodonProvider()],
])('%s media validity', (name, provider) => {
  it('accepts up to 4 images, one video, one GIF, or nothing', async () => {
    for (const media of [[], img(1), img(4), [video], [gif]]) {
      await expect(provider.checkValidity([media], {}, [])).resolves.toBe(true);
    }
  });

  it('refuses a fifth image', async () => {
    await expect(provider.checkValidity([img(5)], {}, [])).resolves.toBe(
      `${name} allows up to 4 images per post.`
    );
  });

  it('refuses a video or GIF mixed with other media', async () => {
    for (const media of [[...img(1), video], [video, video], [gif, ...img(2)]]) {
      await expect(provider.checkValidity([media], {}, [])).resolves.toBe(
        `${name} allows one video or GIF per post, without other media.`
      );
    }
  });

  it('checks every part of a thread, not only the first', async () => {
    await expect(
      provider.checkValidity([img(1), img(5)], {}, [])
    ).resolves.not.toBe(true);
  });
});
