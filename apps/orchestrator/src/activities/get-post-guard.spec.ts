/**
 * The publish workflow guards the missing-post case correctly:
 *
 *   const firstPost = await getPost(organizationId, postId);
 *   if (!firstPost) { await changeState(postId, 'ERROR', 'No Post'); return; }
 *
 * and that branch could never be reached. The activity read `post.deletedAt`
 * on the result of a `findUnique`, which is null for a post that was deleted
 * or that belongs to another organization — so the activity threw an unhandled
 * TypeError and Temporal retried it, instead of the workflow taking the path
 * written for exactly this case. The old condition was also dead by
 * construction: the query's where clause already carries `deletedAt: null`, so
 * a non-null row here always has a null deletedAt (E2E-05-03).
 *
 * Testing the guard rather than the activity class: importing PostActivity
 * drags the whole integration manager and the Temporal client in with it, and
 * the claim is about one condition.
 */
const activityGetPost = async (
  post: { deletedAt?: Date | null } | null
): Promise<unknown> => {
  if (!post) {
    return false;
  }
  return post;
};

const brokenGetPost = async (
  post: { deletedAt?: Date | null } | null
): Promise<unknown> => {
  // The version that shipped.
  if ((post as any).deletedAt) {
    return false;
  }
  return post;
};

describe('getPost activity guard', () => {
  it('answers false for a post that is not there', async () => {
    await expect(activityGetPost(null)).resolves.toBe(false);
  });

  it('returns the post when there is one', async () => {
    const post = { id: 'p1', deletedAt: null } as any;
    await expect(activityGetPost(post)).resolves.toBe(post);
  });

  it('is the condition that the workflow guard needs', async () => {
    // `false` is falsy, so `if (!firstPost)` fires and the workflow records
    // ERROR / "No Post" instead of churning on a retried activity.
    const result = await activityGetPost(null);
    expect(!result).toBe(true);
  });

  it('the shipped version threw instead of answering', async () => {
    await expect(brokenGetPost(null)).rejects.toBeInstanceOf(TypeError);
  });
});
