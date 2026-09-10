import { assertUploadableCodec } from './mp4-source';
import { UnsupportedCodecError } from './compositor-pipeline';

describe('assertUploadableCodec', () => {
  it('lets through what a phone or a browser produces', () => {
    for (const codec of ['avc', 'hevc', 'av1', 'vp9', 'vp8']) {
      expect(() => assertUploadableCodec(codec)).not.toThrow();
    }
  });

  it('stops ProRes, which Mediabunny 1.56 can wrap and nothing can play', () => {
    // 1.45 rejected it by accident (it did not know the codec at all). 1.56
    // learned it, remuxed it into a video/mp4 the upload validator accepts, and
    // the failure moved to after publishing.
    expect(() => assertUploadableCodec('prores')).toThrow(UnsupportedCodecError);
  });

  it('stops a file with no video track at all', () => {
    expect(() => assertUploadableCodec(null)).toThrow(UnsupportedCodecError);
  });

  it('names the codec in the error, so the message can say what was wrong', () => {
    try {
      assertUploadableCodec('prores');
      fail('expected a throw');
    } catch (e) {
      expect((e as UnsupportedCodecError).codec).toBe('prores');
    }
  });

  it('stops anything Mediabunny learns next until we allow it on purpose', () => {
    expect(() => assertUploadableCodec('dnxhd')).toThrow(UnsupportedCodecError);
  });
});
