// Importing the real services drags in storage and Prisma.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/chat/auth.context', () => ({
  checkAuth: () => undefined,
}));

jest.mock('undici', () => ({ fetch: jest.fn() }));
jest.mock('@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher', () => ({ ssrfSafeDispatcher: {} }));
jest.mock('@gitroom/nestjs-libraries/upload/file.type', () => ({
  fromBuffer: async () => ({ mime: 'image/png', ext: 'png' }),
}));
jest.mock('@gitroom/nestjs-libraries/media/fetch.media.buffer', () => ({
  readResponseCapped: async () => Buffer.from('png'),
}));

import { fetch } from 'undici';
import { UploadFromUrlTool } from './upload.from.url.tool';

// Upstream 0992c460: the tool only fetches public URLs, and nothing told an
// MCP client where a local or private file goes instead. A private address
// threw from the SSRF guard instead of answering.
describe('uploadFromUrlTool', () => {
  const tool = new UploadFromUrlTool({} as any).run() as any;
  const context = {
    requestContext: new Map([['organization', JSON.stringify({ id: 'org-1' })]]),
  };

  it('says where local and private files go', () => {
    expect(tool.description).toContain('POST /public/v1/upload');
  });

  it('answers a private address with the way to upload it', async () => {
    (fetch as jest.Mock).mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: new Error('private address') }));
    const result = await tool.execute({ url: 'http://127.0.0.1/file.png' }, context);
    expect(result.errors).toContain('POST /public/v1/upload');
  });

  // The library search looks at the original name only; a file uploaded by an
  // assistant had none and could not be found by name (upstream #2024).
  it('keeps the name the file had at its URL', async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({ ok: true });
    const saveFile = jest.fn().mockResolvedValue({ id: 'm1', path: 'https://cdn.example/x.png' });
    const named = new UploadFromUrlTool({ saveFile, assertStorage: jest.fn() } as any);
    (named as any).storage = { uploadFile: async () => ({ originalname: 'random.png', path: 'https://cdn.example/x.png' }) };
    await (named.run() as any).execute({ url: 'https://example.com/photos/Summer%20menu.png?v=2' }, context);
    expect(saveFile.mock.calls[0][3]).toBe('Summer menu.png');
  });
});
