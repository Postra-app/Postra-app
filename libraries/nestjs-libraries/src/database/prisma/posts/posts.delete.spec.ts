/**
 * E2E-10-35 — `DELETE /posts/:group` odpowiadało `{ error: true }` niezależnie
 * od tego, czy cokolwiek usunęło. Klient nie miał jak odróżnić powodzenia od
 * porażki; web po prostu zawsze pokazywał „usunięto".
 */
// PostsService reaches isomorphic-dompurify through the create-post DTO, and
// that pulls jsdom, which does not start in this repo (its canvas binding is
// unbuilt). Neither matters here.
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

function serviceWith(deleted: { id: string } | null) {
  const repository = { deletePost: jest.fn().mockResolvedValue(deleted) };
  const temporal = {
    client: { getRawClient: () => undefined, getWorkflowHandle: jest.fn() },
  };
  const service = Object.create(PostsService.prototype) as PostsService;
  Object.assign(service, {
    _postRepository: repository,
    _temporalService: temporal,
  });
  return { service, repository };
}

describe('PostsService.deletePost', () => {
  it('mówi, że usunął, i podaje id usuniętego posta', async () => {
    const { service, repository } = serviceWith({ id: 'post-1' });

    await expect(service.deletePost('org-1', 'group-1')).resolves.toEqual({
      deleted: true,
      id: 'post-1',
    });
    expect(repository.deletePost).toHaveBeenCalledWith('org-1', 'group-1');
  });

  it('nieistniejąca grupa: mówi, że nic nie usunął', async () => {
    const { service } = serviceWith(null);

    await expect(service.deletePost('org-1', 'nie-ma-takiej')).resolves.toEqual({
      deleted: false,
      id: null,
    });
  });
});

describe('PostsRepository.deletePost (E2E-05-01)', () => {
  // Imported here so the service mocks above stay the only ones in play.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PostsRepository } = require('@gitroom/nestjs-libraries/database/prisma/posts/posts.repository');

  const repoWith = (count: number) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const findFirst = jest.fn().mockResolvedValue({ id: 'post-1' });
    const prisma = { model: { post: { updateMany, findFirst } } };
    const repo = new PostsRepository(prisma, {}, {}, {}, {}, {}, {});
    return { repo, updateMany, findFirst };
  };

  it('touches only posts that are still live', async () => {
    const { repo, updateMany } = repoWith(1);
    await expect(repo.deletePost('org-1', 'group-1')).resolves.toEqual({
      id: 'post-1',
    });
    expect(updateMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      group: 'group-1',
      deletedAt: null,
    });
  });

  it('a group that was already deleted reports nothing deleted', async () => {
    const { repo, findFirst } = repoWith(0);
    await expect(repo.deletePost('org-1', 'group-1')).resolves.toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
