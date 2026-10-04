jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('@gitroom/helpers/utils/timer', () => ({ timer: () => Promise.resolve() }));

const SIZE = 5 * 1024 * 1024 + 123; // five full megabytes and a tail
const ranges: [number, number][] = [];
jest.mock('@gitroom/nestjs-libraries/media/media.range', () => {
  const actual = jest.requireActual('@gitroom/nestjs-libraries/media/media.range');
  return {
    ...actual,
    mediaSize: jest.fn(async () => SIZE),
    mediaRange: jest.fn(async (_path: string, start: number, end: number) => {
      ranges.push([start, end]);
      return Buffer.alloc(end - start + 1, 1);
    }),
  };
});
// The old way: the whole video downloaded into memory before the upload.
const wholeFile = jest.fn(async () => {
  throw new Error('the whole video was downloaded');
});
jest.mock('@gitroom/helpers/utils/read.or.fetch', () => ({ readOrFetch: () => wholeFile() }));

import { XProvider } from './x.provider';
import { LinkedinProvider } from './linkedin.provider';

// U5 (upstream 5e82d460, 84bee82b): a video goes to X and LinkedIn part by
// part, each read from storage just before it is sent — never the whole file
// in the worker's memory.
const VIDEO = 'https://cdn-dev.postra.pl/uploads/2026/10/04/clip.mp4';

beforeEach(() => {
  ranges.length = 0;
  wholeFile.mockClear();
});

const covered = () => {
  // Contiguous windows from 0 to SIZE - 1, no gap and no overlap.
  let next = 0;
  for (const [start, end] of ranges) {
    expect(start).toBe(next);
    next = end + 1;
  }
  expect(next).toBe(SIZE);
};

describe('X video upload', () => {
  it('sends 1 MB parts read one by one, with the real total size', async () => {
    const x = new XProvider();
    const appended: number[] = [];
    const client = {
      v2: {
        post: jest.fn(async (endpoint: string, body: any) => {
          if (endpoint === 'media/upload/initialize') {
            expect(body.total_bytes).toBe(SIZE);
            expect(body.media_category).toBe('tweet_video');
            return { data: { id: 'm-1' } };
          }
          if (endpoint.endsWith('/append')) {
            appended.push(body.media.length);
            return {};
          }
          return { data: {} };
        }),
        get: jest.fn(),
        uploadMedia: jest.fn(async () => {
          throw new Error('the whole video went through uploadMedia');
        }),
      },
    } as any;

    const uploaded = await (x as any).uploadMedia(client, [{ id: 'p1', media: [{ path: VIDEO }] }]);

    expect(uploaded).toEqual({ p1: ['m-1'] });
    expect(wholeFile).not.toHaveBeenCalled();
    expect(appended).toEqual([...Array(5).fill(1024 * 1024), 123]);
    covered();
    expect(client.v2.post).toHaveBeenLastCalledWith('media/upload/m-1/finalize');
  });

  it('a video X fails to process is a failed post with the reason', async () => {
    const x = new XProvider();
    const client = {
      v2: {
        post: jest.fn(async (endpoint: string) =>
          endpoint.endsWith('/finalize')
            ? { data: { processing_info: { state: 'pending', check_after_secs: 1 } } }
            : { data: { id: 'm-2' } }
        ),
        get: jest.fn(async () => ({
          data: { processing_info: { state: 'failed', error: { message: 'Unsupported codec' } } },
        })),
      },
    } as any;
    await expect(x.uploadVideoInParts(client, VIDEO)).rejects.toThrow('Unsupported codec');
  });
});

describe('LinkedIn video upload', () => {
  it('declares the real size and PUTs 2 MB parts read one by one', async () => {
    const li = new LinkedinProvider();
    const puts: number[] = [];
    jest.spyOn(li as any, 'fetch').mockImplementation(async (url: any, init: any) => {
      if (String(url).includes('initializeUpload')) {
        expect(JSON.parse(init.body).initializeUploadRequest.fileSizeBytes).toBe(SIZE);
        return new Response(
          JSON.stringify({
            value: { video: 'urn:li:video:1', uploadInstructions: [{ uploadUrl: 'https://upload.linkedin.test/part' }] },
          })
        );
      }
      if (init?.method === 'PUT') {
        puts.push((init.body as Buffer).length);
        return new Response('', { headers: { etag: `e${puts.length}` } });
      }
      // finalizeUpload, then the readiness poll.
      return new Response(JSON.stringify({ status: 'AVAILABLE' }));
    });

    const uploaded = await (li as any).processMediaForPosts(
      [{ id: 'p1', media: [{ path: VIDEO }] }],
      'token',
      'person-1',
      'personal'
    );

    expect(wholeFile).not.toHaveBeenCalled();
    expect(puts).toEqual([2 * 1024 * 1024, 2 * 1024 * 1024, 1024 * 1024 + 123]);
    covered();
    expect(uploaded.p1).toEqual(['urn:li:video:1']);
  });
});
