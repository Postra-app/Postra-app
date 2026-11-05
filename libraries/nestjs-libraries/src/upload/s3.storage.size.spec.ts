import { HeadObjectCommand } from '@aws-sdk/client-s3';
import { S3Storage } from './s3.storage';

// The media storage counts every library file. Rows saved while the bucket
// was served under an earlier CDN name keep that address, so the size has to
// be read under that name too.
describe('S3Storage.sizeOf', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  const storage = () => {
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'https://cdn.new.example';
    process.env.RESTRICT_UPLOAD_DOMAINS = 'cdn-old.example';
    process.env.FRONTEND_URL = 'https://app.example';
    const s = new S3Storage('bucket', 'eu-west-2', 'https://cdn.new.example', 'AKID', 'secret');
    const send = jest.fn(async () => ({ ContentLength: 4242 }));
    (s as any)._client.send = send;
    return { s, send };
  };

  it('reads the size of a file under the current CDN name', async () => {
    const { s, send } = storage();
    expect(await s.sizeOf('https://cdn.new.example/2026/11/05/a.mp4')).toBe(4242);
    const cmd = send.mock.calls[0][0] as HeadObjectCommand;
    expect(cmd.input).toEqual({ Bucket: 'bucket', Key: '2026/11/05/a.mp4' });
  });

  it('and under an earlier CDN name the app still accepts as its own', async () => {
    const { s, send } = storage();
    expect(await s.sizeOf('https://cdn-old.example/2026/07/15/b.jpg')).toBe(4242);
    expect((send.mock.calls[0][0] as HeadObjectCommand).input.Key).toBe('2026/07/15/b.jpg');
  });

  it('never asks about a file on someone else\'s host', async () => {
    const { s, send } = storage();
    expect(await s.sizeOf('https://evil.example/2026/a.jpg')).toBeNull();
    expect(await s.sizeOf('not a url')).toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('a file the bucket does not have counts as nothing', async () => {
    const { s, send } = storage();
    send.mockRejectedValueOnce(new Error('NotFound'));
    expect(await s.sizeOf('https://cdn.new.example/gone.jpg')).toBeNull();
  });
});
