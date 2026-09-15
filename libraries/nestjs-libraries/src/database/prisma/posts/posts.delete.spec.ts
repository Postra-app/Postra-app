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
