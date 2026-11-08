jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

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
const s3 = jest.fn();
jest.mock('@gitroom/nestjs-libraries/upload/s3.uploader', () => ({ __esModule: true, default: (...a: any[]) => s3(...a) }));
jest.mock('@gitroom/nestjs-libraries/upload/r2.uploader', () => ({ __esModule: true, default: (...a: any[]) => s3(...a) }));

import { MediaController } from './media.controller';

const response = () => {
  const res: any = { headersSent: false };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

// The browser drives a multipart upload with the key and uploadId
// the first call returned. Another organisation holding that pair could list,
// sign parts into, abort or complete the upload.
describe('multipart upload steps', () => {
  const media = { assertStorage: jest.fn(async () => undefined), saveFile: jest.fn(async () => ({ id: 'm1' })) };
  const controller = new MediaController(media as any, {} as any, {} as any);
  beforeEach(() => {
    store.clear();
    s3.mockReset();
    process.env.STORAGE_PROVIDER = 's3';
  });

  it('another organisation cannot continue an upload', async () => {
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-1', key: '2026/10/26/a.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'a.mp4' } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();

    for (const endpoint of ['list-parts', 'sign-part', 'abort-multipart-upload', 'complete-multipart-upload']) {
      const res = response();
      await controller.uploadFile({ id: 'org-b' } as any, { body: { uploadId: 'up-1', key: '2026/10/26/a.mp4' } } as any, res, endpoint);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    const res = response();
    await controller.uploadFile({ id: 'org-b' } as any, { body: { partData: { uploadId: 'up-1', key: '2026/10/26/a.mp4', parts: [] } } } as any, res, 'prepare-upload-parts');
    expect(res.status).toHaveBeenCalledWith(404);
    expect(s3).not.toHaveBeenCalled();
  });

  it('the organisation that started it carries on, and the start still answers', async () => {
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-2', key: '2026/10/26/b.mp4' })
    );
    const created = response();
    const sent = created.json;
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'b.mp4' } } } as any, created, 'create-multipart-upload');
    expect(sent).toHaveBeenCalledWith({ uploadId: 'up-2', key: '2026/10/26/b.mp4' });

    s3.mockReset();
    s3.mockImplementation(async (_e: string, _req: any, res: any) => res.status(200).json([]));
    const listed = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-2', key: '2026/10/26/b.mp4' } } as any, listed, 'list-parts');
    expect(s3).toHaveBeenCalledTimes(1);
    expect(listed.status).toHaveBeenCalledWith(200);
  });

  // A failed completion (S3 answered 500) is retried by the
  // browser; forgetting the owner at that point turned the retry into a 404.
  it('a completion that failed keeps the upload its organisation’s', async () => {
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-3', key: '2026/10/26/c.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'c.mp4' } } } as any, response(), 'create-multipart-upload');

    s3.mockReset();
    s3.mockImplementation(async (_e: string, _req: any, res: any) => {
      res.headersSent = true;
      return res.status(500).json({ error: 'Upload failed' });
    });
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-3', key: '2026/10/26/c.mp4' } } as any, response(), 'complete-multipart-upload');

    s3.mockReset();
    s3.mockImplementation(async (_e: string, _req: any, res: any) => res.status(200).json([]));
    const retried = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-3', key: '2026/10/26/c.mp4' } } as any, retried, 'list-parts');
    expect(retried.status).toHaveBeenCalledWith(200);
  });
});

// The plan's media storage: a file that does not fit
// is refused before any part is sent, and again on the real assembled size.
describe('multipart upload and the media storage', () => {
  const full = Object.assign(new Error('Your media library is full'), { status: 402 });
  beforeEach(() => {
    store.clear();
    s3.mockReset();
    process.env.STORAGE_PROVIDER = 's3';
  });

  it('a start that would not fit is refused before S3 is asked', async () => {
    const media = { assertStorage: jest.fn(async () => { throw full; }) };
    const controller = new MediaController(media as any, {} as any, {} as any);
    await expect(
      controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'a.mp4', size: 900_000_000 } } } as any, response(), 'create-multipart-upload')
    ).rejects.toBe(full);
    expect(media.assertStorage).toHaveBeenCalledWith('org-a', 900_000_000);
    expect(s3).not.toHaveBeenCalled();
  });

  it('completion checks the assembled size, removes a file that does not fit and saves nothing', async () => {
    const media = {
      assertStorage: jest.fn(async (_o: string, bytes: number) => {
        if (bytes > 1000) throw full;
      }),
      saveFile: jest.fn(),
    };
    const controller = new MediaController(media as any, {} as any, {} as any);
    const removeFile = jest.fn(async () => undefined);
    (controller as any).storage = { removeFile };
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-9', key: '2026/11/05/z.mp4' })
    );
    // Declared small...
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'z.mp4', size: 10 } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();
    // ...assembled big.
    s3.mockImplementation(async () => ({ Location: 'https://cdn.test/2026/11/05/z.mp4', size: 5000 }));
    await expect(
      controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-9', key: '2026/11/05/z.mp4', file: { name: 'z.mp4' } } } as any, response(), 'complete-multipart-upload')
    ).rejects.toBe(full);
    expect(media.assertStorage).toHaveBeenLastCalledWith('org-a', 5000);
    expect(removeFile).toHaveBeenCalledWith('https://cdn.test/2026/11/05/z.mp4');
    expect(media.saveFile).not.toHaveBeenCalled();
  });

  it('an uploader that gives no size: the size is read from the storage, not taken as 0', async () => {
    const media = {
      assertStorage: jest.fn(async () => undefined),
      saveFile: jest.fn(async () => ({ id: 'm2' })),
      storedSize: jest.fn(async () => 7777),
    };
    const controller = new MediaController(media as any, {} as any, {} as any);
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-r2', key: 'r2.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'r2.mp4', size: 10 } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();
    s3.mockImplementation(async () => ({ Location: 'https://r2.test/r2.mp4' }));
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-r2', key: 'r2.mp4', file: { name: 'r2.mp4' } } } as any, response(), 'complete-multipart-upload');
    expect(media.storedSize).toHaveBeenCalledWith('https://r2.test/r2.mp4');
    expect(media.assertStorage).toHaveBeenLastCalledWith('org-a', 7777);
    expect(media.saveFile).toHaveBeenCalledWith('org-a', 'r2.mp4', 'https://r2.test/r2.mp4', 'r2.mp4', false, 7777);
  });

  it('a completion that fits is saved with its real size', async () => {
    const media = { assertStorage: jest.fn(async () => undefined), saveFile: jest.fn(async () => ({ id: 'm1' })) };
    const controller = new MediaController(media as any, {} as any, {} as any);
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-8', key: '2026/11/05/y.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'y.mp4', size: 10 } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();
    s3.mockImplementation(async () => ({ Location: 'https://cdn.test/2026/11/05/y.mp4', size: 4242 }));
    const res = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-8', key: '2026/11/05/y.mp4', file: { name: 'clip.mp4' } } } as any, res, 'complete-multipart-upload');
    expect(media.saveFile).toHaveBeenCalledWith('org-a', 'y.mp4', 'https://cdn.test/2026/11/05/y.mp4', 'clip.mp4', false, 4242);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('sign-part goes only within the declared size', () => {
  const media = { assertStorage: jest.fn(async () => undefined) };
  const controller = new MediaController(media as any, {} as any, {} as any);
  beforeEach(() => {
    store.clear();
    hashes.clear();
    s3.mockReset();
    process.env.STORAGE_PROVIDER = 's3';
  });

  it('a part past the declared 10 bytes is refused before anything is signed', async () => {
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-7', key: '2026/11/05/x.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'x.mp4', size: 10 } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();
    s3.mockImplementation(async (_e: string, _req: any, res: any) => res.status(200).json({ url: 'signed' }));

    const ok = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-7', key: '2026/11/05/x.mp4', partNumber: 1, size: 10 } } as any, ok, 'sign-part');
    expect(ok.status).toHaveBeenCalledWith(200);

    const big = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-7', key: '2026/11/05/x.mp4', partNumber: 2, size: 5 * 1024 ** 3 } } as any, big, 'sign-part');
    expect(big.status).toHaveBeenCalledWith(400);

    const noSize = response();
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-7', key: '2026/11/05/x.mp4', partNumber: 2 } } as any, noSize, 'sign-part');
    expect(noSize.status).toHaveBeenCalledWith(400);
    expect(s3).toHaveBeenCalledTimes(1);
  });
});

// Abuse: once an upload is complete and saved, its pair must not open a way
// back in — another part signed into it, or a second completion that saves
// the same file twice.
describe('after a completed upload', () => {
  const media = {
    assertStorage: jest.fn(async () => undefined),
    saveFile: jest.fn(async () => ({ id: 'm1' })),
    storedSize: jest.fn(async () => 10),
  };
  const controller = new MediaController(media as any, {} as any, {} as any);
  beforeEach(() => {
    store.clear();
    hashes.clear();
    s3.mockReset();
    media.saveFile.mockClear();
    process.env.STORAGE_PROVIDER = 's3';
  });

  it('signing another part or completing again is 404, and nothing is saved twice', async () => {
    s3.mockImplementation(async (_e: string, _req: any, res: any) =>
      res.status(200).json({ uploadId: 'up-9', key: '2026/10/26/z.mp4' })
    );
    await controller.uploadFile({ id: 'org-a' } as any, { body: { file: { name: 'z.mp4', size: 10 } } } as any, response(), 'create-multipart-upload');
    s3.mockReset();
    s3.mockImplementation(async () => ({ Location: 'https://cdn/2026/10/26/z.mp4', size: 10 }));
    await controller.uploadFile({ id: 'org-a' } as any, { body: { uploadId: 'up-9', key: '2026/10/26/z.mp4', file: { name: 'z.mp4' } } } as any, response(), 'complete-multipart-upload');
    expect(media.saveFile).toHaveBeenCalledTimes(1);

    s3.mockReset();
    for (const [endpoint, body] of [
      ['sign-part', { uploadId: 'up-9', key: '2026/10/26/z.mp4', partNumber: 2, size: 5 }],
      ['complete-multipart-upload', { uploadId: 'up-9', key: '2026/10/26/z.mp4' }],
    ] as const) {
      const res = response();
      await controller.uploadFile({ id: 'org-a' } as any, { body } as any, res, endpoint);
      expect(res.status).toHaveBeenCalledWith(404);
    }
    expect(s3).not.toHaveBeenCalled();
    expect(media.saveFile).toHaveBeenCalledTimes(1);
  });
});

// `preventSave` uploads a video's thumbnail without a library row. It went
// around the storage check and took any file the route takes, a 200 MB
// video included, so an organisation could keep writing files to the bucket
// that no library listed and no plan limit counted.
describe('a thumbnail upload (preventSave)', () => {
  const file = (mimetype: string, size: number) =>
    ({ originalname: `t.${mimetype.split('/')[1]}`, mimetype, size, buffer: Buffer.alloc(1) }) as any;
  const build = (full = false) => {
    const media = {
      assertStorage: jest.fn(async () => {
        if (full) throw Object.assign(new Error('Your media storage is full'), { status: 402 });
      }),
      saveFile: jest.fn(),
    };
    const controller = new MediaController(media as any, {} as any, {} as any);
    const uploadFile = jest.fn(async (f: any) => ({ path: `https://cdn/2026/11/08/${f.originalname}`, originalname: f.originalname }));
    (controller as any).storage = { uploadFile };
    return { controller, media, uploadFile };
  };

  it('takes an image and saves no library row', async () => {
    const { controller, media, uploadFile } = build();
    const out = await controller.uploadSimple({ id: 'o1' } as any, file('image/jpeg', 50_000), 'true');
    expect(out).toEqual({ path: 'https://cdn/2026/11/08/t.jpeg' });
    expect(uploadFile).toHaveBeenCalledTimes(1);
    expect(media.saveFile).not.toHaveBeenCalled();
  });

  it('refuses a video before anything is stored', async () => {
    const { controller, uploadFile } = build();
    await expect(controller.uploadSimple({ id: 'o1' } as any, file('video/mp4', 200 * 1024 * 1024), 'true')).rejects.toMatchObject({ status: 400 });
    expect(uploadFile).not.toHaveBeenCalled();
  });

  it('a full library refuses it too', async () => {
    const { controller, uploadFile } = build(true);
    await expect(controller.uploadSimple({ id: 'o1' } as any, file('image/png', 50_000), 'true')).rejects.toMatchObject({ status: 402 });
    expect(uploadFile).not.toHaveBeenCalled();
  });
});
