import { writeFile } from 'fs/promises';
import {
  extractPosterFrame,
  NO_POSTER,
  localSource,
  posterArgs,
  posterFor,
} from '@gitroom/nestjs-libraries/videos/poster/video.poster';

// Every video in the phone app's Media tab was a bare play icon,
// because the only still a media row had was the customer's own cover.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const out = (args: string[]) => args[args.length - 1];

describe('poster frame', () => {
  it('seeks, takes one frame and only reads the protocols it needs', () => {
    const args = posterArgs('https://cdn.example/v.mp4', '1', '/tmp/x.jpg');
    expect(args).toEqual(expect.arrayContaining(['-ss', '1', '-frames:v', '1']));
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file,http,https,tcp,tls');
    expect(args.indexOf('-ss')).toBeLessThan(args.indexOf('-i'));
  });

  it('takes the first frame of a clip shorter than a second', async () => {
    const seeks: string[] = [];
    const run = jest.fn(async (args: string[]) => {
      const seek = args[args.indexOf('-ss') + 1];
      seeks.push(seek);
      // Seeking past the end exits 0 and writes nothing.
      if (seek === '0') await writeFile(out(args), JPEG);
    });
    await expect(extractPosterFrame('https://cdn.example/v.mp4', run)).resolves.toEqual(JPEG);
    expect(seeks).toEqual(['1', '0']);
  });

  it('gives null when ffmpeg cannot read the file at any seek', async () => {
    const run = jest.fn().mockRejectedValue(new Error('ffmpeg exit 1'));
    await expect(extractPosterFrame('https://cdn.example/v.mp4', run)).resolves.toBeNull();
    expect(run).toHaveBeenCalledTimes(2);
  });
});

describe('posterFor', () => {
  const env = process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY;
  beforeAll(() => {
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'https://cdn.postra.example';
  });
  afterAll(() => {
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = env;
  });
  const storage = () => ({ uploadFile: jest.fn().mockResolvedValue({ path: 'https://cdn.postra.example/p.jpg' }) });

  it('stores the frame and returns its public path', async () => {
    const s = storage();
    await expect(
      posterFor('https://cdn.postra.example/2026/11/10/v.mp4', s as any, async () => JPEG)
    ).resolves.toBe('https://cdn.postra.example/p.jpg');
    expect(s.uploadFile.mock.calls[0][0].buffer).toEqual(JPEG);
  });

  it('never fetches a path outside our storage', async () => {
    const s = storage();
    const extract = jest.fn();
    await expect(posterFor('http://169.254.169.254/latest', s as any, extract)).resolves.toBeNull();
    expect(extract).not.toHaveBeenCalled();
    expect(s.uploadFile).not.toHaveBeenCalled();
  });

  it('marks a video that is there but has no frame, so the daily run does not retry it', async () => {
    const s = storage();
    await expect(
      posterFor('https://cdn.postra.example/v.mp4', s as any, async () => null, async () => true)
    ).resolves.toBe(NO_POSTER);
    expect(s.uploadFile).not.toHaveBeenCalled();
  });

  // Found on the stack: with the file unreachable the video was marked as
  // having no frame for good, and nothing would ever try it again.
  it('writes nothing when the file did not answer, so it is tried again', async () => {
    const s = storage();
    await expect(
      posterFor('https://cdn.postra.example/v.mp4', s as any, async () => null, async () => false)
    ).resolves.toBeNull();
  });
});

describe('localSource', () => {
  const env = { STORAGE_PROVIDER: 'local', UPLOAD_DIRECTORY: '/data/uploads', FRONTEND_URL: 'http://app.test' };

  it('reads a local upload from the upload directory', () => {
    expect(localSource('http://app.test/uploads/2026/11/10/a.mp4', env)).toBe('/data/uploads/2026/11/10/a.mp4');
  });

  it.each([
    'http://app.test/uploads/../../etc/passwd',
    'http://app.test/uploads/%2e%2e/%2e%2e/etc/passwd',
    'http://other.test/uploads/a.mp4',
  ])('never leaves the upload directory or another host: %s', (path) => {
    expect(localSource(path, env)).toBeNull();
  });

  it('is off for any other storage', () => {
    expect(localSource('http://app.test/uploads/a.mp4', { ...env, STORAGE_PROVIDER: 's3' })).toBeNull();
  });
});
