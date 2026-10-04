jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { InstagramProvider } from './instagram.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { GmbProvider } from './gmb.provider';
import { numericId } from './numeric.id';

// CodeQL js/request-forgery #73/#74: page ids from the client went into the
// Graph API / LinkedIn API / Business Profile API path with the user's token.
describe('page ids from the client', () => {
  const fetchSpy = jest.spyOn(global, 'fetch' as any);
  afterEach(() => fetchSpy.mockReset());

  const json = (body: unknown) =>
    Promise.resolve({ json: () => Promise.resolve(body) } as Response);

  it('numericId keeps a numeric id and refuses anything else', () => {
    expect(numericId('17841400000000001234')).toBe('17841400000000001234');
    for (const bad of ['', ' 1', '1 ', '0x1f', '1e3', '1/2', '1?x=', '../1', null, undefined]) {
      expect(() => numericId(bad)).toThrow('Invalid page');
    }
  });

  it('Instagram refuses a non-numeric page or account id before any request', async () => {
    const ig = new InstagramProvider();
    for (const data of [{ pageId: 'me/accounts', id: '1' }, { pageId: '1', id: '../me?x=' }]) {
      await expect(ig.fetchPageInformation('t___u', data)).rejects.toThrow('Invalid page');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Instagram puts only the numeric ids into the Graph API path', async () => {
    fetchSpy.mockImplementation(() => json({ id: '2', access_token: 'p' }));
    await new InstagramProvider().fetchPageInformation('t___u', { pageId: '11', id: '22' });
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/11\?fields=/);
    expect(urls[1]).toMatch(/^https:\/\/graph\.facebook\.com\/v[\d.]+\/22\?fields=/);
  });

  it('LinkedIn Page refuses a non-numeric organisation id before any request', async () => {
    const li = new LinkedinPageProvider();
    await expect(li.fetchPageInformation('t', { page: '123/../../me' })).rejects.toThrow('Invalid page');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Business Profile refuses a location path that is not accounts/<n>/locations/<n>', async () => {
    const gmb = new GmbProvider();
    for (const id of ['accounts/1/locations/2/media', 'accounts/1/locations/..', 'locations/2', '']) {
      await expect(
        gmb.fetchPageInformation('t', { id, accountName: 'accounts/1', locationName: 'locations/2' })
      ).rejects.toThrow('Invalid page');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('Business Profile builds the API path and the channel id from the numbers, not from locationName', async () => {
    fetchSpy.mockImplementation(() => json({ title: 'Cafe', mediaItems: [] }));
    const page = await new GmbProvider().fetchPageInformation('t', {
      id: 'accounts/123/locations/456',
      accountName: 'accounts/123',
      locationName: 'accounts/999/whatever?x=',
    });
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls[0]).toMatch(/^https:\/\/mybusinessbusinessinformation\.googleapis\.com\/v1\/locations\/456\?readMask=/);
    expect(urls[1]).toBe('https://mybusinessbusinessinformation.googleapis.com/v1/locations/456/media');
    expect(page.id).toBe('accounts/123/locations/456');
  });
});
