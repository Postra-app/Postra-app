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
/**
 * ⭐ And the same hole sat one function above, untouched: `getPostsByGroup`
 * reads `posts[0].integrationId` after the identical `arrangePostsByGroup`
 * call. Measured on production 2026-09-19 while reviewing Sentry — the two
 * issues sat side by side in the feed:
 *   GET /posts/<stale-id>            → 404  (this file's fix, already shipped)
 *   GET /posts/group/<stale-group>   → 500  (its twin, still broken)
 * Fixing one twin and not the other is exactly how the first one survived, so
 * both are pinned here now.
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


describe('PostsService.getPostsByGroup', () => {
  const buildGroup = (posts: any[] | null) => {
    const service = build([]);
    // The repository is a constructor arg stubbed as `{}` by `build`, so give
    // it the one method this path calls; arranging is what decides the shape.
    (service as any)._postRepository = {
      getPostsByGroup: jest.fn().mockResolvedValue([]),
    };
    jest
      .spyOn(service as any, 'arrangePostsByGroup')
      .mockReturnValue(posts as any);
    return service;
  };

  it('⛔ answers 404 for a group that resolves to nothing, not a 500', async () => {
    const service = buildGroup([]);
    await expect(
      service.getPostsByGroup('org-1', 'nope')
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 404 when arranging returns nothing at all', async () => {
    const service = buildGroup(null);
    await expect(
      service.getPostsByGroup('org-1', 'nope')
    ).rejects.toThrow('Post not found');
  });

  it('still returns the group when there is one', async () => {
    const service = buildGroup([
      {
        id: 'p1',
        group: 'g1',
        integrationId: 'i1',
        integration: { picture: 'pic.png' },
        settings: '{"a":1}',
        image: '[]',
      },
    ]);

    await expect(
      service.getPostsByGroup('org-1', 'g1')
    ).resolves.toMatchObject({
      group: 'g1',
      integration: 'i1',
      integrationPicture: 'pic.png',
      settings: { a: 1 },
    });
  });
});
