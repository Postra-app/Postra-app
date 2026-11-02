import {
  lastStreakPostAt,
  OrganizationRepository,
  STREAK_LOOKAHEAD_MS,
} from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

const H = 3_600_000;
const D = 24 * H;
const now = Date.UTC(2026, 10, 2, 9, 0, 0);

// Upstream acf6c2430: a daily post scheduled exactly a day after the previous
// one, and every recurring post, ended the streak.
describe('lastStreakPostAt', () => {
  it('counts a post due at the instant the streak is checked', () => {
    expect(lastStreakPostAt([new Date(now)], [], now)).toBe(now);
    expect(lastStreakPostAt([new Date(now + STREAK_LOOKAHEAD_MS - 1)], [], now)).toBe(now);
  });

  it("counts a recurring post's latest occurrence, not its first", () => {
    const first = new Date(now - 10 * D);
    expect(lastStreakPostAt([], [{ publishDate: first, intervalInDays: 1 }], now)).toBe(now);
    const weekly = new Date(now - 10 * D);
    expect(lastStreakPostAt([], [{ publishDate: weekly, intervalInDays: 7 }], now)).toBe(now - 3 * D);
  });

  it('takes the newest of all, never in the future, and null without posts', () => {
    expect(lastStreakPostAt([new Date(now - 2 * D), new Date(now - H)], [], now)).toBe(now - H);
    expect(lastStreakPostAt([], [], now)).toBeNull();
  });
});

describe('OrganizationRepository.getLastPublishDate', () => {
  it('asks for published posts and posts about to publish, recurring ones apart', async () => {
    const findUnique = jest
      .fn()
      .mockResolvedValueOnce({ post: [{ publishDate: new Date(now - H) }] })
      .mockResolvedValueOnce({ post: [] });
    const repo = new OrganizationRepository(
      { model: { organization: { findUnique } } } as any,
      {} as any, {} as any, {} as any, {} as any
    );
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      await expect(repo.getLastPublishDate('org-1')).resolves.toBe(now - H);
    } finally {
      clock.mockRestore();
    }
    const single = findUnique.mock.calls[0][0].select.post.where;
    expect(single).toMatchObject({ deletedAt: null, parentPostId: null, intervalInDays: null });
    expect(single.OR).toEqual([
      { state: 'PUBLISHED' },
      { state: 'QUEUE', publishDate: { lte: new Date(now + STREAK_LOOKAHEAD_MS) } },
    ]);
    const recurring = findUnique.mock.calls[1][0].select.post.where;
    expect(recurring.intervalInDays).toEqual({ not: null });
  });
});
