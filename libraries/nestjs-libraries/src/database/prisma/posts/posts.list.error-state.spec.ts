import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';
import { State } from '@prisma/client';

/**
 * A post whose publication failed vanished from the mobile agenda without a
 * trace. The agenda asks for `state=scheduled`, which is exactly
 * `State.QUEUE`, so a post moving to `State.ERROR` simply stopped existing for
 * the user: no row, no marker, no reason. That is the product's core promise
 * ("schedule it and we publish it") failing silently.
 *
 * ⛔ Asking for `state=all` was not a way out, and this is the part that made
 * the bug survive review twice. `all` DOES include `State.ERROR` in its state
 * list — but every filter except `published` also carried `publishDate >= now`,
 * and a failed post's publishDate is in the past by definition. Measured on
 * production 2026-09-19 with three ERROR posts sitting in the calendar:
 *
 *   GET /posts/list?state=all    → t = 55, every row QUEUE   (53 published and
 *                                  3 failed posts silently cut by the date)
 *   GET /posts/list?state=error  → 400, not an accepted value
 *
 * So the fix is two things that have to travel together: a state the client can
 * actually ask for, and lifting the "upcoming" date filter off it the same way
 * `published` already had it lifted.
 */
const buildRepo = () => {
  const findMany = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  const prisma = { model: { post: { findMany, count } } } as any;
  const repo = new PostsRepository(
    prisma,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );
  return { repo, findMany };
};

const callWith = async (state: any) => {
  const { repo, findMany } = buildRepo();
  await repo.getPostsList('org-1', { state, page: 0, limit: 20 } as any);
  return findMany.mock.calls[0][0];
};

describe('getPostsList - failed posts have to be reachable', () => {
  it('state=error asks for ERROR only', async () => {
    const args = await callWith('error');
    expect(args.where.state).toBe(State.ERROR);
  });

  it('state=error is not cut by the upcoming-date filter', async () => {
    const args = await callWith('error');
    expect(args.where.publishDate).toBeUndefined();
  });

  it('state=error reads newest failure first', async () => {
    const args = await callWith('error');
    expect(args.orderBy.publishDate).toBe('desc');
  });

  // Regression guards: the three filters that were already correct must not
  // move. `scheduled` is what the mobile agenda and the web both ask for.
  it('state=scheduled still means upcoming QUEUE, oldest first', async () => {
    const args = await callWith('scheduled');
    expect(args.where.state).toBe(State.QUEUE);
    expect(args.where.publishDate.gte).toBeInstanceOf(Date);
    expect(args.orderBy.publishDate).toBe('asc');
  });

  it('state=published still skips the date filter and reads newest first', async () => {
    const args = await callWith('published');
    expect(args.where.state).toBe(State.PUBLISHED);
    expect(args.where.publishDate).toBeUndefined();
    expect(args.orderBy.publishDate).toBe('desc');
  });

  // This used to pin "upcoming drafts only", which hid
  // a past-dated draft from the Draft tab while "All" still listed it.
  it('state=draft lists drafts whatever their date, newest first', async () => {
    const args = await callWith('draft');
    expect(args.where.state).toBe(State.DRAFT);
    expect(args.where.publishDate).toBeUndefined();
    expect(args.orderBy.publishDate).toBe('desc');
  });
});

/**
 * The same date filter made the tab labelled "All" answer 55 of
 * 111 rows. `all` already listed every state; the `publishDate >= now` clause
 * then cut the past ones straight back out. Measured on production 2026-09-20
 * on the main org:
 *
 *   GET /posts/list?state=all        → t = 55, every row QUEUE
 *   GET /posts/list?state=published  → t = 53   (none of them in `all`)
 *   three more posts sat in ERROR    (none of them in `all` either)
 *
 * This is not a mobile problem. `calendar.context.tsx` starts with
 * `listState = 'all'`, so it is the web's DEFAULT list tab, and the label was
 * lying to everyone who opened it.
 */
describe('getPostsList - "all" has to mean all', () => {
  it('lists every state', async () => {
    const args = await callWith('all');
    expect(args.where.state.in).toEqual(
      expect.arrayContaining([
        State.QUEUE,
        State.DRAFT,
        State.PUBLISHED,
        State.ERROR,
      ])
    );
  });

  it('is not cut by the upcoming-date filter', async () => {
    const args = await callWith('all');
    expect(args.where.publishDate).toBeUndefined();
  });

  it('reads newest first, so page 1 is not last July', async () => {
    const args = await callWith('all');
    expect(args.orderBy.publishDate).toBe('desc');
  });

  it('is what an absent state falls back to', async () => {
    const { repo, findMany } = buildRepo();
    await repo.getPostsList('org-1', { page: 0, limit: 20 } as any);
    const args = findMany.mock.calls[0][0];
    expect(args.where.publishDate).toBeUndefined();
    expect(args.where.state.in).toContain(State.ERROR);
  });
});

describe('getPostsList - drafts and repeating posts', () => {
  it('state=draft keeps drafts dated in the past', async () => {
    const args = await callWith('draft');
    expect(args.where.state).toBe(State.DRAFT);
    expect(args.where.publishDate).toBeUndefined();
  });

  it.each(['all', 'scheduled', 'draft', 'published', 'error'])(
    'state=%s does not hide repeating posts',
    async (state) => {
      const args = await callWith(state);
      expect(args.where).not.toHaveProperty('intervalInDays');
    }
  );

  it('state=scheduled still only lists what is upcoming', async () => {
    const args = await callWith('scheduled');
    expect(args.where.publishDate).toBeDefined();
  });
});

// The list (the only view on a phone) showed a failed post with "An error
// occurred while publishing this post", while the week view named the cause.
// The list now carries the same readable reason.
describe('getPostsList - the reason a post failed', () => {
  it('reads the error and gives it back readable', async () => {
    const { repo, findMany } = buildRepo();
    findMany.mockResolvedValue([
      { id: 'p1', state: State.ERROR, error: 'Media aspect ratio is not supported by Instagram' },
    ]);
    const result = await repo.getPostsList('org-1', { state: 'error', page: 0, limit: 20 } as any);
    expect(findMany.mock.calls[0][0].select.error).toBe(true);
    expect(result.posts[0].error).toBe('Media aspect ratio is not supported by Instagram');
  });
});

// A failed post moved to a new date is scheduled again (QUEUE) and keeps the
// text of its old failure in the row until it is published. The list said
// "scheduled" and showed that failure next to it.
describe('getPostsList - an error belongs to a failed post only', () => {
  const listOf = async (row: any) => {
    const { repo, findMany } = buildRepo();
    findMany.mockResolvedValue([row]);
    const { posts } = await repo.getPostsList('org-1', { state: 'all', page: 0, limit: 20 } as any);
    return posts[0];
  };

  it('a scheduled post shows no error, whatever the row still holds', async () => {
    const post = await listOf({ id: 'p1', state: State.QUEUE, error: 'Refresh channel needed' });
    expect(post.error).toBeNull();
  });

  it('a failed post shows its error', async () => {
    const post = await listOf({ id: 'p1', state: State.ERROR, error: 'Refresh channel needed' });
    expect(post.error).toBe('Refresh channel needed');
  });
});
