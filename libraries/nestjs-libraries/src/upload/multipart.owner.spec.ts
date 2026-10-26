const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => store.delete(k)),
  },
}));

import {
  forgetUpload,
  ownsUpload,
  recordUploadOwner,
  uploadPairOf,
} from '@gitroom/nestjs-libraries/upload/multipart.owner';

// E2E-11-70: a multipart upload belongs to the organisation that started it.
describe('multipart upload owner', () => {
  beforeEach(() => store.clear());

  it('the organisation that started it may continue it, another may not', async () => {
    await recordUploadOwner('org-a', 'up-1', '2026/10/26/abc.mp4');

    expect(await ownsUpload('org-a', 'up-1', '2026/10/26/abc.mp4')).toBe(true);
    expect(await ownsUpload('org-b', 'up-1', '2026/10/26/abc.mp4')).toBe(false);
    // The pair travels together: the same upload id with another key is not it.
    expect(await ownsUpload('org-a', 'up-1', '2026/10/26/other.mp4')).toBe(false);
  });

  it('an upload nobody started, or one already completed, is nobody’s', async () => {
    expect(await ownsUpload('org-a', 'up-2', 'k')).toBe(false);
    expect(await ownsUpload('org-a', undefined, 'k')).toBe(false);
    await recordUploadOwner('org-a', 'up-3', 'k');
    await forgetUpload('up-3');
    expect(await ownsUpload('org-a', 'up-3', 'k')).toBe(false);
  });

  it('reads the pair where each step sends it', () => {
    expect(uploadPairOf('prepare-upload-parts', { partData: { uploadId: 'u', key: 'k' } })).toEqual({ uploadId: 'u', key: 'k' });
    expect(uploadPairOf('sign-part', { uploadId: 'u', key: 'k' })).toEqual({ uploadId: 'u', key: 'k' });
  });
});
