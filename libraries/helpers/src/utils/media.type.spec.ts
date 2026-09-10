import { isVideoMedia, mediaTypeFromPath } from './media.type';

describe('mediaTypeFromPath', () => {
  it('recognises the extensions storage can produce', () => {
    expect(mediaTypeFromPath('2026/09/10/AbCdEfGhIj.mp4')).toBe('video');
    expect(mediaTypeFromPath('https://cdn/2026/09/10/x.MOV')).toBe('video');
    expect(mediaTypeFromPath('clip.webm')).toBe('video');
  });

  it('treats everything else as an image', () => {
    expect(mediaTypeFromPath('2026/09/10/AbCdEfGhIj.jpg')).toBe('image');
    expect(mediaTypeFromPath('design.png')).toBe('image');
    expect(mediaTypeFromPath(undefined)).toBe('image');
    expect(mediaTypeFromPath(null)).toBe('image');
  });

  it('does not match an extension that only appears inside the name', () => {
    // The old `path.indexOf('mp4') > -1` check called this a video.
    expect(mediaTypeFromPath('holiday-mp4-still.jpg')).toBe('image');
  });

  it('ignores a query string after the extension', () => {
    expect(mediaTypeFromPath('https://cdn/x.mp4?v=2')).toBe('video');
  });
});

describe('isVideoMedia', () => {
  it('trusts the column once it is set', () => {
    expect(isVideoMedia({ type: 'video', path: 'no-extension' })).toBe(true);
  });

  it('falls back to the path for rows written before the backfill', () => {
    expect(isVideoMedia({ type: 'image', path: '2026/07/12/x.mp4' })).toBe(true);
    expect(isVideoMedia({ path: '2026/07/12/x.mp4' })).toBe(true);
  });

  it('says no for images and for nothing at all', () => {
    expect(isVideoMedia({ type: 'image', path: 'a.jpg' })).toBe(false);
    expect(isVideoMedia(undefined)).toBe(false);
    expect(isVideoMedia(null)).toBe(false);
  });
});
