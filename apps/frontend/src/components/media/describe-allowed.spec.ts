import { describeAllowed } from '@gitroom/frontend/components/media/describe-allowed';

describe('the upload refusal says what to do', () => {
  // HEIC is the iPhone default and the uploader takes JPG, PNG, WebP and GIF
  // only: the refusal used to stop at the list, so an iPhone user had no way on.
  it('tells an iPhone user to export HEIC photos as JPEG', () => {
    expect(describeAllowed('image/*')).toBe(
      'Upload an image (JPG, PNG, WebP or GIF). For iPhone HEIC photos, export them as JPEG first.'
    );
    expect(describeAllowed('image/*,video/mp4')).toBe(
      'Upload an image or an MP4 video. For iPhone HEIC photos, export them as JPEG first.'
    );
  });

  it('says nothing about photos where only video is taken', () => {
    expect(describeAllowed('video/mp4')).toBe('Upload an MP4 video.');
    expect(describeAllowed('')).toBe('');
  });
});
