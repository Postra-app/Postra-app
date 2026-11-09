type PostCount = (args: { where: Record<string, unknown> }) => Promise<number>;

// The one definition of "a post that went out" for Admin → Dashboards: a
// top-level post (not a comment or thread reply), not deleted, by its publish
// date — the same rows Admin → Stats counts. The card read Temporal's
// workflow counter, which the SDK creates on the first completed workflow of
// each process, so increase() never saw that first publish and the card
// showed fewer publishes than Stats after every restart or deploy.
export const countPostsSince = async (count: PostCount, since: Date) => {
  const where = (state: 'PUBLISHED' | 'ERROR') => ({
    state,
    deletedAt: null as null,
    parentPostId: null as null,
    publishDate: { gte: since },
  });
  const [published, failed] = await Promise.all([
    count({ where: where('PUBLISHED') }),
    count({ where: where('ERROR') }),
  ]);
  return { published, failed };
};
