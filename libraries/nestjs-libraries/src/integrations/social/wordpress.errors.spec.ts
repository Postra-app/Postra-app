import { WordpressProvider } from './wordpress.provider';
import { BadBody, RefreshToken } from '../social.abstract';

// A revoked or replaced application password makes WordPress answer 401
// rest_cannot_create to a new post. Postra told the customer the user lacked
// permissions and never asked for a reconnect, so every later post failed
// the same way.
const answer = (status: number, body: object) =>
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status }));

describe('WordpressProvider errors', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a 401 to a new post asks for a reconnect', async () => {
    answer(401, {
      code: 'rest_cannot_create',
      message: 'Sorry, you are not allowed to create posts as this user.',
      data: { status: 401 },
    });
    const err = await new WordpressProvider()
      .fetch('https://blog.example.com/wp-json/wp/v2/posts', { method: 'POST', body: '{}' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(RefreshToken);
    expect(err.message).toContain('Reconnect the channel');
  });

  it('a 403 to a new post is the user lacking permission, not a reconnect', async () => {
    answer(403, {
      code: 'rest_cannot_create',
      message: 'Sorry, you are not allowed to create posts as this user.',
      data: { status: 403 },
    });
    const err = await new WordpressProvider()
      .fetch('https://blog.example.com/wp-json/wp/v2/posts', { method: 'POST', body: '{}' })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadBody);
    expect(err).not.toBeInstanceOf(RefreshToken);
    expect(err.message).toContain('not allowed to publish posts');
  });
});
