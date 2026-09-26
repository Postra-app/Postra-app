/**
 * E2E-05-08, E2E-05-12 — malformed input on /posts, /posts/valid and
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
  };
  const integrations = { getIntegrationsByIds: jest.fn().mockResolvedValue([]) };
  const s = Object.create(PostsService.prototype) as PostsService;
  Object.assign(s, {
    _postRepository: repository,
    _integrationService: integrations,
  });
  return { s, repository };
}

describe('PostsService.validatePosts — body shape', () => {
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

describe('PostsService.changeDate — bad input', () => {
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
      'org', 'p1', '2026-10-01T10:00:00', false, 'update'
    );
  });
});
