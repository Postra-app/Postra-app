jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => store.delete(k)),
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

// E2E-11-70: the browser drives a multipart upload with the key and uploadId
// the first call returned. Another organisation holding that pair could list,
// sign parts into, abort or complete the upload.
describe('multipart upload steps', () => {
  const controller = new MediaController({} as any, {} as any, {} as any);
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
});
