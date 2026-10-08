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
    const result = await tool.execute({ url: 'http://127.0.0.1/file.png' }, context);
    expect(result.errors).toContain('POST /public/v1/upload');
  });
});
