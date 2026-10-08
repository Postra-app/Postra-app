const thread = { likeCount: 0 };
const repost = jest.fn();
const post = jest.fn();
jest.mock('@atproto/api', () => ({
  BskyAgent: class {
    login = jest.fn();
    getPostThread = jest.fn(async () => ({ data: { thread: { post: { uri: 'at://p', cid: 'c', likeCount: thread.likeCount } } } }));
    repost = repost;
    post = post;
  },
  RichText: class {
    text: string;
    facets = [];
    constructor({ text }: { text: string }) {
      this.text = text;
    }
  },
  AppBskyEmbedVideo: {},
  AppBskyVideoDefs: {},
  AtpAgent: class {},
  BlobRef: class {},
}));
jest.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: { fixedDecryption: () => JSON.stringify({ service: 'https://bsky.social', identifier: 'a', password: 'b' }) },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => undefined }));

import { BlueskyProvider } from './bluesky.provider';

// A plug is checked every 6 hours, 3 times; `true` means "done, stop". Both
// Bluesky plugs said done below the likes threshold, so a post that reached
// it at hour 12 was never reposted (docs P3 check, 2026-10-09). X answers
// `false` there.
describe('Bluesky plugs below the likes threshold', () => {
  const provider = new BlueskyProvider();
  const integration = { customInstanceDetails: 'x' } as any;

  beforeEach(() => {
    repost.mockClear();
    post.mockClear();
  });

  it('keeps checking the repost plug', async () => {
    thread.likeCount = 3;
    await expect(provider.autoRepostPost(integration, 'at://p', { likesAmount: '10' })).resolves.toBe(false);
    expect(repost).not.toHaveBeenCalled();
  });

  it('keeps checking the plug-post plug', async () => {
    thread.likeCount = 3;
    await expect(provider.autoPlugPost(integration, 'at://p', { likesAmount: '10', post: 'Thanks for the likes!' })).resolves.toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('acts and stops once the threshold is reached', async () => {
    thread.likeCount = 12;
    await expect(provider.autoRepostPost(integration, 'at://p', { likesAmount: '10' })).resolves.toBe(true);
    expect(repost).toHaveBeenCalledTimes(1);
  });
});
