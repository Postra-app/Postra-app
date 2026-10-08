import {
  isPexelsAssetUrl,
  pexelsPhotoHits,
  pexelsVideoHits,
} from '@gitroom/nestjs-libraries/media/pexels';

describe('Pexels', () => {
  it('keeps the credit and the larger file of a photo', () => {
    expect(
      pexelsPhotoHits({
        photos: [
          {
            id: 1,
            url: 'https://www.pexels.com/photo/1/',
            photographer: 'Ann',
            photographer_url: 'https://www.pexels.com/@ann',
            alt: 'Cake',
            src: { medium: 'https://images.pexels.com/m.jpg', large2x: 'https://images.pexels.com/l.jpg' },
          },
          { id: 2, src: {} },
        ],
      })
    ).toEqual([
      {
        id: 1,
        previewURL: 'https://images.pexels.com/m.jpg',
        importURL: 'https://images.pexels.com/l.jpg',
        pageURL: 'https://www.pexels.com/photo/1/',
        user: 'Ann',
        userURL: 'https://www.pexels.com/@ann',
        alt: 'Cake',
      },
    ]);
  });

  it('imports a video at up to 1920 wide and previews the smallest', () => {
    const [hit] = pexelsVideoHits({
      videos: [
        {
          id: 9,
          url: 'https://www.pexels.com/video/9/',
          image: 'https://images.pexels.com/t.jpg',
          duration: 12,
          user: { name: 'Bo', url: 'https://www.pexels.com/@bo' },
          video_files: [
            { file_type: 'video/mp4', width: 3840, link: 'uhd' },
            { file_type: 'video/mp4', width: 1920, link: 'hd' },
            { file_type: 'video/mp4', width: 640, link: 'sd' },
            { file_type: 'video/webm', width: 1280, link: 'webm' },
          ],
        },
      ],
    });
    expect(hit).toMatchObject({ importURL: 'hd', previewURL: 'sd', user: 'Bo', duration: 12 });
  });

  it("imports only from Pexels' own https hosts", () => {
    expect(isPexelsAssetUrl('https://images.pexels.com/photos/1/a.jpeg')).toBe(true);
    expect(isPexelsAssetUrl('https://videos.pexels.com/video-files/1/a.mp4')).toBe(true);
    for (const bad of [
      'http://images.pexels.com/a.jpg',
      'https://images.pexels.com.evil.test/a.jpg',
      'https://user:pw@images.pexels.com/a.jpg',
      'https://example.com/a.jpg',
      'http://169.254.169.254/',
      undefined,
    ]) {
      expect(isPexelsAssetUrl(bad)).toBe(false);
    }
  });
});
