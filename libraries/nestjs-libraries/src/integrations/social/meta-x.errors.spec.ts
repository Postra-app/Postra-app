jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));

import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { ThreadsProvider } from './threads.provider';
import { XProvider } from './x.provider';

// Platform rejections the customer used to see as "Unknown Error" or as the
// wrong kind of failure (upstream U12): a temporary block that should be
// retried, a lost permission that needs a reconnect, an account behind a
// checkpoint that fails every post until the user acts.

const graph = (error: Record<string, unknown>) => JSON.stringify({ error });

describe('Facebook errors', () => {
  const fb = new FacebookProvider();

  it('the temporary posting-rate block (368 / 1390008) is retried', () => {
    expect(fb.handleErrors(graph({ code: 368, error_subcode: 1390008 }), 400)?.type).toBe('retry');
  });

  it('"Sorry, something went wrong" is retried', () => {
    expect(fb.handleErrors(graph({ message: 'Sorry, something went wrong.' }), 500)?.type).toBe('retry');
  });

  it('a user token instead of a page token asks for a reconnect', () => {
    const body = graph({ message: 'Unpublished posts must be posted to a page as the page itself.' });
    const handled = fb.handleErrors(body, 400);
    expect(handled?.type).toBe('refresh-token');
    expect(handled?.value).toContain('Postra');
  });

  it('(#200) names the missing Page access', () => {
    expect(fb.handleErrors(graph({ message: '(#200) Permissions error', code: 200 }), 403)?.value).toContain(
      'full content access'
    );
  });

  it('missing page permissions ask for a reconnect', () => {
    const body = graph({ message: 'The pages_manage_posts permission must be granted before impersonating a user' });
    expect(fb.handleErrors(body, 400)?.type).toBe('refresh-token');
  });

  it.each([
    [459, 'security check'],
    [492, 'no longer has a role'],
  ])('subcode %i has its own message', (subcode, text) => {
    expect(fb.handleErrors(graph({ code: 190, error_subcode: subcode }), 400)?.value).toContain(text);
  });

  it('a subcode only matches on its own number', () => {
    // 4590 is not 459.
    expect(fb.handleErrors(graph({ code: 1, error_subcode: 4590 }), 400)?.value ?? '').not.toContain(
      'security check'
    );
  });

  it('a page listed without a page token says so on connect', async () => {
    const listing = { data: [{ id: '123', name: 'Shop', access_token: undefined }] };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response(JSON.stringify(listing)));
    try {
      await expect(fb.fetchPageInformation('user-token', { page: '123' })).rejects.toThrow(
        'no permission to manage this page'
      );
    } finally {
      fetchMock.mockRestore();
    }
  });
});

describe('X errors', () => {
  const x = new XProvider();

  it('"Too Many Requests" is retried', () => {
    expect(x.handleErrors('{"title":"Too Many Requests","status":429}')?.type).toBe('retry');
  });

  it('an Unauthorized media upload asks for a reconnect', () => {
    expect(x.handleErrors('{"title":"Unauthorized","type":"about:blank","status":401}')?.type).toBe(
      'refresh-token'
    );
  });

  it.each([
    ['Your account is temporarily locked', 'temporarily locked'],
    ['Crypto addresses are prohibited', 'crypto addresses'],
    ['Your media IDs are invalid.', 're-upload the media'],
    ['Please include either text or media in your Tweet.', 'no text or media'],
    ['This user is not allowed to post a video longer than 10 minutes', '10 minutes'],
  ])('"%s" has a readable message', (body, text) => {
    expect(x.handleErrors(body)?.value).toContain(text);
  });
});

describe('Instagram errors', () => {
  const ig = new InstagramProvider();

  it('a Meta checkpoint marks the channel for reconnecting', () => {
    const body = graph({ message: 'You cannot access the app till you log in to www.instagram.com' });
    const handled = ig.handleErrors(body, 400);
    expect(handled?.type).toBe('refresh-token');
    expect(handled?.value).toContain('log in at instagram.com');
  });

  it('(#200) names the missing Page access', () => {
    expect(ig.handleErrors(graph({ message: '(#200) Permissions error' }), 403)?.value).toContain(
      'full content access'
    );
  });

  it('2207085 has a video-format message', () => {
    expect(ig.handleErrors(graph({ error_subcode: 2207085 }), 400)?.value).toContain('video format');
  });

  it('a container Instagram could not process fails with its reason, not at media_publish', () => {
    expect(() => ig.failedContainer('ERROR', 'Error: 2207085')).toThrow('video format');
    expect(() => ig.failedContainer('EXPIRED', 'Media expired')).toThrow('Media expired');
    expect(() => ig.failedContainer('FINISHED')).not.toThrow();
    expect(() => ig.failedContainer('IN_PROGRESS')).not.toThrow();
  });

  it('a container blocked by a checkpoint asks for a reconnect', () => {
    try {
      ig.failedContainer('ERROR', 'Session key is malformed');
      throw new Error('did not throw');
    } catch (e: any) {
      expect(e.type).toBe('refresh_token');
    }
  });
});

describe('Threads errors', () => {
  it('a container error "UNKNOWN" gets a readable message', async () => {
    const threads = new ThreadsProvider();
    jest
      .spyOn(threads as any, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ status: 'ERROR', error_message: 'UNKNOWN', id: 'c1' })));
    await expect((threads as any).checkLoaded('c1', 'token')).rejects.toThrow(
      'Threads could not process the media'
    );
  });
});
