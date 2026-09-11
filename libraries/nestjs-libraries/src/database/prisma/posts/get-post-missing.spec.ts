// PostsService reaches isomorphic-dompurify through the create-post DTO, and
// that pulls jsdom, which does not start in this repo (its canvas binding is
// unbuilt). Neither matters here — nothing in these tests sanitizes anything.
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
import { NotFoundException } from '@nestjs/common';

/**
 * `GET /posts/:id` answered an unhandled TypeError for an id that resolves to
 * nothing: "Cannot read properties of undefined (reading 'integrationId')",
 * seen in Sentry on production. `getPostsRecursively` is org-scoped, so a
 * stale id, a deleted post, or an id belonging to another organization all
 * land in the same place.
 *
 * Two of the four properties being read already used optional chaining, which
 * is how this survived — the hardening stopped halfway. Optional chaining on
 * the rest would have been worse than a 404: it answers with an empty post and
 * the composer renders a blank editor as though the post existed (E2E-05-02).
 */
const build = (posts: any[] | null) => {
  const service = new PostsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest
    .spyOn(service, 'getPostsRecursively')
    .mockResolvedValue(posts as any);
  jest.spyOn(service, 'updateMedia').mockResolvedValue([] as any);
  jest
    .spyOn(service as any, 'stripIntegrationSecrets')
    .mockImplementation((p: any) => p);
  return service;
};

describe('PostsService.getPost', () => {
  it('answers 404 for an id that resolves to nothing', async () => {
    const service = build([]);
    await expect(service.getPost('org-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('answers 404 rather than an empty post', async () => {
    // The failure mode this replaces: a blank editor that looks like a real,
    // empty post.
    const service = build([]);
    await expect(service.getPost('org-1', 'nope')).rejects.toThrow(
      'Post not found'
    );
  });

  it('answers 404 when the repository returns nothing at all', async () => {
    const service = build(null);
    await expect(service.getPost('org-1', 'nope')).rejects.toBeInstanceOf(
      NotFoundException
    );
  });

  it('still returns the post when there is one', async () => {
    const service = build([
      {
        id: 'p1',
        group: 'g1',
        integrationId: 'i1',
        integration: { picture: 'pic.png' },
        settings: '{"a":1}',
        image: '[]',
      },
    ]);

    await expect(service.getPost('org-1', 'p1')).resolves.toMatchObject({
      group: 'g1',
      integration: 'i1',
      integrationPicture: 'pic.png',
      settings: { a: 1 },
    });
  });

  it('does not fall over when the post has no integration relation', async () => {
    const service = build([
      {
        id: 'p1',
        group: 'g1',
        integrationId: 'i1',
        integration: null,
        settings: '',
        image: '[]',
      },
    ]);

    await expect(service.getPost('org-1', 'p1')).resolves.toMatchObject({
      integrationPicture: undefined,
      settings: {},
    });
  });
});
