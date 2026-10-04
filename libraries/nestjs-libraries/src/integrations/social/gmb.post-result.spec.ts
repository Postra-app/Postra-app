jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { GmbProvider } from './gmb.provider';

// Google answers 200 for a local post it rejected on policy, and sometimes
// with no post at all; both were reported as published (upstream f700b8a1,
// 1d965049). The release link is Google's own when it gives one (6345ca57).
describe('Business Profile publish result', () => {
  const answer = (body: unknown) => {
    const provider = new GmbProvider();
    (provider as any).fetch = async () => ({
      json: async () => (body instanceof Error ? Promise.reject(body) : body),
    });
    return provider.post(
      'accounts/1/locations/2',
      'token',
      [{ id: 'p1', message: 'Open on Sunday', settings: {}, media: [] }] as any
    );
  };

  it('a post Google rejected fails with the reason', async () => {
    await expect(answer({ name: 'accounts/1/locations/2/localPosts/9', state: 'REJECTED' })).rejects.toThrow(
      'content policy violation'
    );
  });

  it('an answer without the post (or not JSON) fails instead of "published"', async () => {
    await expect(answer({})).rejects.toThrow('did not confirm');
    await expect(answer(new SyntaxError('Unexpected token <'))).rejects.toThrow('did not confirm');
  });

  it('a published post links to Google Search when Google says where', async () => {
    const [result] = await answer({
      name: 'accounts/1/locations/2/localPosts/9',
      state: 'LIVE',
      searchUrl: 'https://local.google.com/place?id=1&use=posts&lpsid=9',
    });
    expect(result).toMatchObject({ postId: 'accounts/1/locations/2/localPosts/9', status: 'success' });
    expect(result.releaseURL).toBe('https://local.google.com/place?id=1&use=posts&lpsid=9');
  });
});
