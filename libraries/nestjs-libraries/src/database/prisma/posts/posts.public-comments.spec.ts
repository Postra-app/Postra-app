import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

// E2E-11-71: GET /public/posts/:id/comments needs no login. The preview of a
// deleted post is empty, but its comments were still served to anyone with
// the link. Only a post that still exists has comments to show.
describe('public comments', () => {
  it('are read only for a post that is not deleted', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = Object.create(PostsRepository.prototype) as PostsRepository;
    (repository as any)._comments = { model: { comments: { findMany } } };

    await repository.getComments('post-1');

    expect(findMany.mock.calls[0][0].where).toEqual({
      postId: 'post-1',
      deletedAt: null,
      post: { deletedAt: null },
    });
  });
});
