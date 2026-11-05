const store = new Map<string, string>();
const hashes = new Map<string, Record<string, string>>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (...keys: string[]) => { keys.forEach((k) => { store.delete(k); hashes.delete(k); }); return keys.length; }),
    hgetall: jest.fn(async (k: string) => ({ ...(hashes.get(k) || {}) })),
    hset: jest.fn(async (k: string, f: string, v: string) => { hashes.set(k, { ...(hashes.get(k) || {}), [f]: v }); return 1; }),
    expire: jest.fn(async () => 1),
  },
}));

import {
  forgetUpload,
  ownsUpload,
  recordUploadOwner,
  reservePart,
  uploadPairOf,
} from '@gitroom/nestjs-libraries/upload/multipart.owner';

// A multipart upload belongs to the organisation that started it.
describe('multipart upload owner', () => {
  beforeEach(() => { store.clear(); hashes.clear(); });

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

// 2026-11-05: a client that skips our apps could declare 10 MB and then
// put 5 GB into each of hundreds of parts. Parts are signed for their exact
// size and only while they fit in the declared file.
describe('multipart parts fit the declared size', () => {
  const MB = 1024 * 1024;
  beforeEach(() => { store.clear(); hashes.clear(); });

  it('signs parts until the declared size is used up, and not one byte more', async () => {
    await recordUploadOwner('org-a', 'up-1', 'k.mp4', 25 * MB);
    expect(await reservePart('up-1', 1, 10 * MB)).toBe(true);
    expect(await reservePart('up-1', 2, 10 * MB)).toBe(true);
    expect(await reservePart('up-1', 3, 5 * MB + 1)).toBe(false);
    expect(await reservePart('up-1', 3, 5 * MB)).toBe(true);
    expect(await reservePart('up-1', 4, 1)).toBe(false);
  });

  it('a part signed again (a retry) replaces its size instead of adding to it', async () => {
    await recordUploadOwner('org-a', 'up-2', 'k.mp4', 10 * MB);
    expect(await reservePart('up-2', 1, 10 * MB)).toBe(true);
    expect(await reservePart('up-2', 1, 10 * MB)).toBe(true);
  });

  it('refuses a part with no size, a nonsense size or number, or an upload with no declared size', async () => {
    await recordUploadOwner('org-a', 'up-3', 'k.mp4', 10 * MB);
    expect(await reservePart('up-3', 1, undefined)).toBe(false);
    expect(await reservePart('up-3', 1, 0)).toBe(false);
    expect(await reservePart('up-3', 1, 1.5)).toBe(false);
    expect(await reservePart('up-3', 0, 10)).toBe(false);
    expect(await reservePart('up-3', 10001, 10)).toBe(false);
    await recordUploadOwner('org-a', 'up-4', 'k.mp4');
    expect(await reservePart('up-4', 1, 10)).toBe(false);
  });

  it('forgetting the upload drops its sizes too', async () => {
    await recordUploadOwner('org-a', 'up-5', 'k.mp4', 10 * MB);
    await reservePart('up-5', 1, MB);
    await forgetUpload('up-5');
    expect(await reservePart('up-5', 1, MB)).toBe(false);
  });
});
