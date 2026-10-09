// Shapes from the X API v2 reference: GET /2/tweets/:id/liking_users pages
// users 100 at a time (meta.result_count = users on this page); GET
// /2/tweets/:id with tweet.fields=public_metrics carries the full like_count.
const likes = { total: 0 };
const retweet = jest.fn();
const tweet = jest.fn();
jest.mock('twitter-api-v2', () => ({
  TwitterApi: class {
    v2 = {
      tweetLikedBy: jest.fn(async () => ({
        data: [],
        meta: { result_count: Math.min(likes.total, 100), next_token: 'n' },
      })),
      singleTweet: jest.fn(async () => ({
        data: {
          id: '1',
          text: 'x',
          public_metrics: {
            retweet_count: 0,
            reply_count: 0,
            like_count: likes.total,
            quote_count: 0,
            bookmark_count: 0,
            impression_count: 0,
          },
        },
      })),
      retweet,
      tweet,
    };
  },
}));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: async () => undefined }));

import { XProvider } from './x.provider';

// E2E-05-91: X plugs compared the users on one page of liking_users (at most
// 100) with the threshold, so a threshold over 100 never fired.
describe('X plugs and the likes threshold', () => {
  const provider = new XProvider();
  const integration = { token: 'a:b', internalId: 'me' } as any;

  beforeEach(() => {
    retweet.mockClear();
    tweet.mockClear();
  });

  it('reposts at 250 likes for a threshold of 150', async () => {
    likes.total = 250;
    await expect(
      provider.autoRepostPost(integration, '1', { likesAmount: '150' })
    ).resolves.toBe(true);
    expect(retweet).toHaveBeenCalledWith('me', '1');
  });

  it('plugs at 250 likes for a threshold of 150', async () => {
    likes.total = 250;
    await expect(
      provider.autoPlugPost(integration, '1', { likesAmount: '150', post: 'Try Postra' })
    ).resolves.toBe(true);
    expect(tweet).toHaveBeenCalled();
  });

  it('waits below the threshold', async () => {
    likes.total = 40;
    await expect(
      provider.autoRepostPost(integration, '1', { likesAmount: '150' })
    ).resolves.toBe(false);
    await expect(
      provider.autoPlugPost(integration, '1', { likesAmount: '150', post: 'Try Postra' })
    ).resolves.toBe(false);
    expect(retweet).not.toHaveBeenCalled();
    expect(tweet).not.toHaveBeenCalled();
  });
});
