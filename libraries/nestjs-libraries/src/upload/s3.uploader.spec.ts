process.env.S3_BUCKET = 'bucket';
process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'https://cdn.test';

import {
  CompleteMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import handleS3Upload from './s3.uploader';

// The size declared when a multipart upload starts is the client's word only:
// S3 never sees it and every presigned part takes up to 5 GB. complete has to
// check the size of what was actually assembled.

// An MP4 `ftyp` box is enough for file-type to say video/mp4.
const MP4_HEAD = Buffer.from(
  '000000206674797069736f6d0000020069736f6d69736f32617663316d703431',
  'hex'
);
const JPEG_HEAD = Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex');

const run = async (key: string, head: Buffer, total: number) => {
  const sent: any[] = [];
  jest.spyOn(S3Client.prototype, 'send').mockImplementation(async (cmd: any) => {
    sent.push(cmd);
    if (cmd instanceof CompleteMultipartUploadCommand) return { Location: 'x' };
    if (cmd instanceof GetObjectCommand) {
      return {
        ContentRange: `bytes 0-${Math.min(4100, total - 1)}/${total}`,
        Body: (async function* () {
          yield head;
        })(),
      };
    }
    return {};
  });
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const req: any = { body: { key, uploadId: 'u1', parts: [{ ETag: 'e', PartNumber: 1 }] } };
  const out = await handleS3Upload('complete-multipart-upload', req, res);
  return { out, res, deleted: sent.some((c) => c instanceof DeleteObjectCommand) };
};

describe('S3 multipart complete', () => {
  afterEach(() => jest.restoreAllMocks());

  it('keeps a video within the limit and returns its CDN address', async () => {
    const { out, res, deleted } = await run('2026/10/04/a.mp4', MP4_HEAD, 200 * 1024 * 1024);
    expect(res.status).not.toHaveBeenCalled();
    expect(deleted).toBe(false);
    expect((out as any).Location).toBe('https://cdn.test/2026/10/04/a.mp4');
  });

  it('deletes a video assembled past 4 GB whatever size was declared', async () => {
    const { res, deleted } = await run('2026/10/04/b.mp4', MP4_HEAD, 5 * 1024 ** 3);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/exceeds the maximum allowed size/);
    expect(deleted).toBe(true);
  });

  it('deletes an image assembled past 10 MB', async () => {
    const { res, deleted } = await run('2026/10/04/c.jpg', JPEG_HEAD, 11 * 1024 * 1024);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(deleted).toBe(true);
  });
});
