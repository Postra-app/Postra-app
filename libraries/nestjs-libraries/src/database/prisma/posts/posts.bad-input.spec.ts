/**
 * Malformed input on /posts, /posts/valid and
 * PUT /posts/:id/date surfaced as 500s (and Sentry issues) instead of 400/404.
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

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

function service(post: any) {
  const repository = {
    getPostById: jest.fn().mockResolvedValue(post),
    changeDate: jest.fn().mockResolvedValue({ id: 'p1' }),
    transaction: jest.fn((write: (tx: unknown) => unknown) => write({})),
  };
  const integrations = { getIntegrationsByIds: jest.fn().mockResolvedValue([]) };
  const s = Object.create(PostsService.prototype) as PostsService;
  Object.assign(s, {
    _postRepository: repository,
    _integrationService: integrations,
  });
  return { s, repository };
}

describe('PostsService.validatePosts - body shape', () => {
  // One request named the same picture a hundred thousand times; the
  // provider's check downloaded every one of them at once.
  it('refuses a post with more media than any post can have, before reading them', async () => {
    const { s } = service(null);
    const image = Array.from({ length: 100_000 }, () => ({ path: 'https://cdn.example.com/a.png' }));
    const integrations = (s as any)._integrationService.getIntegrationsByIds;
    await expect(
      s.validatePosts('org', [{ integration: { id: 'i1' }, value: [{ content: 'x', image }] }] as any)
    ).rejects.toThrow('At most 20 media files');
    expect(integrations).not.toHaveBeenCalled();
  });

  it('refuses more channels or more items than a request can have', async () => {
    const { s } = service(null);
    const post = { integration: { id: 'i1' }, value: [{ content: 'x' }] };
    await expect(s.validatePosts('org', Array(51).fill(post) as any)).rejects.toThrow('At most 50 channels');
    await expect(
      s.validatePosts('org', [{ integration: { id: 'i1' }, value: Array(101).fill({ content: 'x' }) }] as any)
    ).rejects.toThrow('At most 100 posts and comments');
    await expect(
      s.validatePosts('org', [{ integration: { id: 'i1' }, value: [{ image: { length: 5 } }] }] as any)
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it.each(['abc', 42, { a: 1 }])('rejects posts=%p with 400', async (bad) => {
    const { s } = service(null);
    await expect(s.validatePosts('org', bad as any)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });

  it('still treats a missing list as empty', async () => {
    const { s } = service(null);
    await expect(s.validatePosts('org', undefined as any)).resolves.toEqual([]);
  });
});

describe('PostsService.changeDate - bad input', () => {
  it('404s a post that is not in this org, and touches nothing', async () => {
    const { s, repository } = service(null);
    await expect(
      s.changeDate('org', 'foreign', '2026-10-01T10:00:00', 'schedule')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.changeDate).not.toHaveBeenCalled();
  });

  it.each(['abc', '', undefined])('400s date=%p before any lookup', async (date) => {
    const { s, repository } = service({ id: 'p1', state: 'QUEUE' });
    await expect(
      s.changeDate('org', 'p1', date as any, 'update')
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getPostById).not.toHaveBeenCalled();
  });

  it('keeps working for a valid move', async () => {
    const { s, repository } = service({ id: 'p1', state: 'QUEUE' });
    await s.changeDate('org', 'p1', '2026-10-01T10:00:00', 'update');
    expect(repository.changeDate).toHaveBeenCalledWith(
      'org', 'p1', '2026-10-01T10:00:00', false, 'update', {}
    );
  });
});

describe('PostsService.createComment', () => {
  it('404s a post from another org instead of throwing a plain Error', async () => {
    const repository = { getPostById: jest.fn().mockResolvedValue(null), createComment: jest.fn() };
    const s = Object.create(PostsService.prototype) as PostsService;
    Object.assign(s, { _postRepository: repository });
    await expect(s.createComment('org', 'user', 'foreign', 'hi')).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(repository.createComment).not.toHaveBeenCalled();
  });
});

describe('PostsService.updateReleaseId', () => {
  const svc = (updated: any) => {
    const repository = { updateReleaseId: jest.fn().mockResolvedValue(updated) };
    const s = Object.create(PostsService.prototype) as PostsService;
    Object.assign(s, { _postRepository: repository });
    return { s, repository };
  };

  it('404s a post that is not waiting for a release id (or not this org’s)', async () => {
    const { s } = svc(null);
    await expect(s.updateReleaseId('org', 'p1', '123')).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([undefined, '', '  ', 'missing', 'x'.repeat(201)])('400s releaseId=%p', async (v) => {
    const { s, repository } = svc({ id: 'p1' });
    await expect(s.updateReleaseId('org', 'p1', v as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateReleaseId).not.toHaveBeenCalled();
  });

  it('connects a real id', async () => {
    const { s, repository } = svc({ id: 'p1', releaseId: '7290' });
    await s.updateReleaseId('org', 'p1', ' 7290 ');
    expect(repository.updateReleaseId).toHaveBeenCalledWith('p1', 'org', '7290');
  });
});
