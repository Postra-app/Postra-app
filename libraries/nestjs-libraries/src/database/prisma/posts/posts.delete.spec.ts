/**
 * E2E-10-35 — `DELETE /posts/:group` answered `{ error: true }` whether or not
 * it deleted anything. The client could not tell success from failure; the web
 * app simply always said "deleted".
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

function serviceWith(deleted: { id: string; ids: string[] } | null, running: string[] = []) {
  const repository = { deletePost: jest.fn().mockResolvedValue(deleted) };
  const terminated: string[] = [];
  const queries: string[] = [];
  const temporal = {
    client: {
      getRawClient: () => ({
        workflow: {
          list: ({ query }: { query: string }) => {
            queries.push(query);
            return (async function* () {
              for (const id of running) {
                if (query.includes(`postId="${id}"`)) yield { workflowId: `post_${id}` };
              }
            })();
          },
        },
      }),
      getWorkflowHandle: async (workflowId: string) => ({
        describe: async () => ({ status: { name: 'RUNNING' } }),
        terminate: async () => terminated.push(workflowId),
      }),
    },
  };
  const service = Object.create(PostsService.prototype) as PostsService;
  Object.assign(service, {
    _postRepository: repository,
    _temporalService: temporal,
  });
  return { service, repository, terminated, queries };
}

describe('PostsService.deletePost', () => {
  it('mówi, że usunął, i podaje id usuniętego posta', async () => {
    const { service, repository } = serviceWith({ id: 'post-1', ids: ['post-1'] });

    await expect(service.deletePost('org-1', 'group-1')).resolves.toEqual({
      deleted: true,
      id: 'post-1',
    });
    expect(repository.deletePost).toHaveBeenCalledWith('org-1', 'group-1');
  });

  it('a post on three channels: every channel\'s workflow is terminated', async () => {
    const { service, terminated } = serviceWith(
      { id: 'post-1', ids: ['post-1', 'post-2', 'post-3'] },
      ['post-1', 'post-2', 'post-3']
    );
    await service.deletePost('org-1', 'group-1');
    expect(terminated.sort()).toEqual(['post_post-1', 'post_post-2', 'post_post-3']);
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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PostsRepository } = require('@gitroom/nestjs-libraries/database/prisma/posts/posts.repository');

  const repoWith = (count: number) => {
    const updateMany = jest.fn().mockResolvedValue({ count });
    const findMany = jest.fn().mockResolvedValue([{ id: 'post-1' }, { id: 'post-2' }]);
    const prisma = { model: { post: { updateMany, findMany } } };
    const repo = new PostsRepository(prisma, {}, {}, {}, {}, {}, {});
    return { repo, updateMany, findMany };
  };

  it('touches only posts that are still live', async () => {
    const { repo, updateMany, findMany } = repoWith(1);
    await expect(repo.deletePost('org-1', 'group-1')).resolves.toEqual({
      id: 'post-1',
      ids: ['post-1', 'post-2'],
    });
    expect(findMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      group: 'group-1',
      deletedAt: null,
      parentPostId: null,
    });
    expect(updateMany.mock.calls[0][0].where).toEqual({
      organizationId: 'org-1',
      group: 'group-1',
      deletedAt: null,
    });
  });

  it('a group that was already deleted reports nothing deleted', async () => {
    const { repo } = repoWith(0);
    await expect(repo.deletePost('org-1', 'group-1')).resolves.toBeNull();
  });
});
