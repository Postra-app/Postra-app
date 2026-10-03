jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { InstagramProvider } from './instagram.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';

// CodeQL js/request-forgery #73/#74: page ids from the client went into the
// Graph API / LinkedIn API path with the user's token.
describe('page ids from the client', () => {
  const fetchSpy = jest.spyOn(global, 'fetch' as any);
  afterEach(() => fetchSpy.mockReset());

  it('Instagram refuses a non-numeric page or account id before any request', async () => {
    const ig = new InstagramProvider();
    for (const data of [{ pageId: 'me/accounts', id: '1' }, { pageId: '1', id: '../me?x=' }]) {
      await expect(ig.fetchPageInformation('t___u', data)).rejects.toThrow('Invalid page');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('LinkedIn Page refuses a non-numeric organisation id before any request', async () => {
    const li = new LinkedinPageProvider();
    await expect(li.fetchPageInformation('t', { page: '123/../../me' })).rejects.toThrow('Invalid page');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
