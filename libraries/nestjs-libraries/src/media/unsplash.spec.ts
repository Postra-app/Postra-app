import {
  isUnsplashAssetUrl,
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
});
