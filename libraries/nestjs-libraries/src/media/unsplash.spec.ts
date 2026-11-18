import {
  isUnsplashAssetUrl,
  creditLinesFromClient,
  unsplashCredit,
  isUnsplashDownloadLocation,
  unsplashPhotoHits,
  withReferral,
} from '@gitroom/nestjs-libraries/media/unsplash';

describe('Unsplash', () => {
  it('keeps the credit with a referral back, and the download report URL', () => {
    const [hit] = unsplashPhotoHits({
      results: [
        {
          id: 'abc',
          alt_description: 'Bread',
          urls: { small: 'https://images.unsplash.com/s', regular: 'https://images.unsplash.com/r' },
          links: { html: 'https://unsplash.com/photos/abc', download_location: 'https://api.unsplash.com/photos/abc/download?ixid=1' },
          user: { name: 'Ann', links: { html: 'https://unsplash.com/@ann' } },
        },
        { id: 'bad', urls: {} },
      ],
    });
    expect(hit).toEqual({
      id: 'abc',
      previewURL: 'https://images.unsplash.com/s',
      importURL: 'https://images.unsplash.com/r',
      pageURL: 'https://unsplash.com/photos/abc?utm_source=postra&utm_medium=referral',
      user: 'Ann',
      userURL: 'https://unsplash.com/@ann?utm_source=postra&utm_medium=referral',
      alt: 'Bread',
      downloadLocation: 'https://api.unsplash.com/photos/abc/download?ixid=1',
    });
    expect(withReferral('https://unsplash.com/@a?x=1')).toBe('https://unsplash.com/@a?x=1&utm_source=postra&utm_medium=referral');
  });

  it('fetches files only from Unsplash and reports downloads only to its API', () => {
    expect(isUnsplashAssetUrl('https://images.unsplash.com/photo-1?w=1080')).toBe(true);
    expect(isUnsplashAssetUrl('https://images.unsplash.com.evil.test/x')).toBe(false);
    expect(isUnsplashAssetUrl('http://images.unsplash.com/x')).toBe(false);
    expect(isUnsplashDownloadLocation('https://api.unsplash.com/photos/abc/download?ixid=1')).toBe(true);
    expect(isUnsplashDownloadLocation('https://api.unsplash.com/me')).toBe(false);
    expect(isUnsplashDownloadLocation('http://169.254.169.254/latest/meta-data')).toBe(false);
  });

  // Unsplash's condition for production use: the post text credits the
  // photographer and Unsplash, with their social handle when they have one.
  it('builds the credit for the post text from the photographer Unsplash returns', () => {
    expect(unsplashCredit({ user: { name: 'Ana Lens', instagram_username: 'ana.lens' } })).toBe(
      'Photo by Ana Lens (@ana.lens) on Unsplash'
    );
    expect(unsplashCredit({ user: { name: 'Ana Lens', twitter_username: '@analens' } })).toBe(
      'Photo by Ana Lens (@analens) on Unsplash'
    );
    expect(unsplashCredit({ user: { name: 'Ana  Lens' } })).toBe('Photo by Ana Lens on Unsplash');
    // A handle that is not one is left out rather than printed.
    expect(unsplashCredit({ user: { name: 'Ana', instagram_username: 'not a handle!' } })).toBe(
      'Photo by Ana on Unsplash'
    );
    expect(unsplashCredit(null)).toBe('');
    expect(unsplashCredit({ user: {} })).toBe('');
  });

  it('keeps only credit lines from a client, so the field cannot carry other text into posts', () => {
    expect(creditLinesFromClient('Photo by Ana on Unsplash\nPhoto by Bo  Light (@bo) on Unsplash')).toBe(
      'Photo by Ana on Unsplash\nPhoto by Bo Light (@bo) on Unsplash'
    );
    expect(creditLinesFromClient('Buy now at evil.test\nPhoto by Ana on Unsplash')).toBe('Photo by Ana on Unsplash');
    expect(creditLinesFromClient('Photo by <script> on Unsplash')).toBe('');
    expect(creditLinesFromClient(undefined)).toBe('');
    expect(creditLinesFromClient(Array(20).fill('Photo by Ana on Unsplash').join('\n'))).toBe('Photo by Ana on Unsplash');
  });
});

