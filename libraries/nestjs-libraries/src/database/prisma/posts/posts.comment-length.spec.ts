/**
 * /posts/valid checked every item against the post's limit, so a TikTok
 * comment of 1,201-2,000 characters passed and failed only at publish
 * (TikTok API for Business takes up to 1,200).
 */
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

function service() {
  const s = Object.create(PostsService.prototype) as PostsService;
  Object.assign(s, {
    _integrationService: {
      getIntegrationsByIds: jest.fn().mockResolvedValue([
        { id: 'i1', providerIdentifier: 'tiktok', name: 'T', additionalSettings: '[]' },
      ]),
    },
    _integrationManager: { getSocialIntegration: () => new TiktokProvider() },
  });
  return s;
}

const image = [{ id: 'm', path: 'https://cdn.example.com/a.jpg' }];
const check = (comment: string) =>
  service().validatePosts('org', [
    {
      integration: { id: 'i1' },
      settings: {},
      value: [
        { content: 'caption', image },
        { content: comment, image: [] },
      ],
    },
  ] as any);

describe('PostsService.validatePosts - TikTok comment length', () => {
  it('marks a comment over 1,200 characters as too long', async () => {
    const [result] = await check('a'.repeat(1201));
    expect(result.tooLong).toBe(true);
  });

  it('lets a comment of 1,200 characters through', async () => {
    const [result] = await check('a'.repeat(1200));
    expect(result.tooLong).toBe(false);
  });

  it('keeps 2,000 characters for the caption', async () => {
    const [result] = await service().validatePosts('org', [
      { integration: { id: 'i1' }, settings: {}, value: [{ content: 'a'.repeat(2000), image }] },
    ] as any);
    expect(result.tooLong).toBe(false);
  });
});
