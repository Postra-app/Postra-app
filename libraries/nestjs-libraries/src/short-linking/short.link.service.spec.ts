import { ShortLinkService } from './short.link.service';

// E2E-05-50 (POSTS-11): a shortener that answered without a link (an error
// body, a quota message) replaced the URL in the post with the word
// "undefined", and the broken post was published.
describe('shortening the links of a post', () => {
  const original = ShortLinkService.provider;
  afterEach(() => {
    ShortLinkService.provider = original;
  });

  it('keeps the original link when the shortener gives no link back, or fails', async () => {
    ShortLinkService.provider = {
      shortLinkDomain: 'sho.rt',
      convertLinkToShortLink: async (_id: string, url: string) => {
        if (url.includes('fails')) throw new Error('quota');
        return url.includes('ok') ? 'https://sho.rt/x' : undefined;
      },
    } as any;
    const [text] = await new ShortLinkService().convertTextToShortLinks('org', [
      'see https://example.com/ok and https://example.com/no and https://example.com/fails',
    ]);
    expect(text).toBe('see https://sho.rt/x and https://example.com/no and https://example.com/fails');
  });
});
