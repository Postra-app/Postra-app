import { PostsRepository } from './posts.repository';

// A post that failed and was then published again kept the old error next to
// its link: the calendar hides it, but the API and the assistant read a
// published post with "Failed to parse URL…" on it.
describe('a post published after a failure', () => {
  it('no longer carries the error of the failed attempt', async () => {
    const update = jest.fn().mockResolvedValue({});
    const repository = Object.create(PostsRepository.prototype);
    Object.assign(repository, { _post: { model: { post: { update } } } });

    await repository.updatePost('post-1', 'release-1', 'https://example.com/p/1', 'org-1');

    expect(update).toHaveBeenCalledWith({
      where: { id: 'post-1', organizationId: 'org-1' },
      data: {
        state: 'PUBLISHED',
        releaseURL: 'https://example.com/p/1',
        releaseId: 'release-1',
        error: null,
      },
    });
  });
});
