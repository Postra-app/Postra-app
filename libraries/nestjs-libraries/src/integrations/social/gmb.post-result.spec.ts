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

// A channel without a location carried the Google user id: the post went to
// v4/<user id>/localPosts and Google's HTML 404 came back as "Unknown Error"
// (upstream #2051).
describe('Business Profile channel without a location', () => {
  it('is refused before anything is sent to Google', async () => {
    const provider = new GmbProvider();
    const fetch = jest.fn();
    (provider as any).fetch = fetch;
    await expect(
      provider.post('108123456789', 'token', [{ id: 'p1', message: 'Open on Sunday', settings: {}, media: [] }] as any)
    ).rejects.toThrow('no business location chosen');
    expect(fetch).not.toHaveBeenCalled();
  });

  it("Google's HTML 404 reads as a missing location, not an unknown error", () => {
    expect(new GmbProvider().handleErrors('<title>Error 404 (Not Found)!!1</title>')).toMatchObject({
      type: 'bad-body',
      value: expect.stringContaining('Business location not found'),
    });
  });
});
