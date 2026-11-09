import { countPostsSince } from './posts-published.count';

// Admin → Dashboards counted Temporal's counter and lost the first publish
// of every process; it now counts the rows Stats counts.
describe('countPostsSince', () => {
  it('counts top-level, not deleted posts by publish date, published and failed', async () => {
    const since = new Date('2026-11-08T20:00:00Z');
    const seen: any[] = [];
    const result = await countPostsSince(async (args) => {
      seen.push(args.where);
      return args.where.state === 'PUBLISHED' ? 4 : 1;
    }, since);
    expect(result).toEqual({ published: 4, failed: 1 });
    expect(seen).toEqual([
      { state: 'PUBLISHED', deletedAt: null, parentPostId: null, publishDate: { gte: since } },
      { state: 'ERROR', deletedAt: null, parentPostId: null, publishDate: { gte: since } },
    ]);
  });
});
