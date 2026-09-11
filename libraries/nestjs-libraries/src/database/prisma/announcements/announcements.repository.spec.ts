import { AnnouncementsRepository } from '@gitroom/nestjs-libraries/database/prisma/announcements/announcements.repository';

/**
 * An announcement is served to every signed-in session and stopped only when
 * an operator remembers to delete it, so an outage notice outlives the outage
 * (E2E-09-26). Delete is now soft, which keeps the audit row pointing at
 * something and keeps "delete something already gone" a 200 answering
 * `deleted:false` rather than a 500 (E2E-09-46).
 */
const buildPrisma = () => {
  const announcement = {
    findMany: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn(async ({ data }: any) => ({ id: 'a1', ...data })),
    updateMany: jest.fn(async () => ({ count: 1 })),
  };
  return { model: { announcement } };
};

describe('AnnouncementsRepository', () => {
  it('shows only what a session should see', async () => {
    const prisma = buildPrisma();
    const repo = new AnnouncementsRepository(prisma as any);

    await repo.getAnnouncements();

    const args = prisma.model.announcement.findMany.mock.calls[0][0] as any;
    expect(args.where.deletedAt).toBeNull();
    expect(args.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ]);
    // Every page load hits this, so it is capped.
    expect(args.take).toBeGreaterThan(0);
  });

  it('keeps expired entries in the panel list', async () => {
    const prisma = buildPrisma();
    const repo = new AnnouncementsRepository(prisma as any);

    await repo.listAnnouncements({ skip: 20, limit: 20 });

    const args = prisma.model.announcement.findMany.mock.calls[0][0] as any;
    expect(args.where).toEqual({ deletedAt: null });
    expect(args.where.OR).toBeUndefined();
    expect(args).toMatchObject({ skip: 20, take: 20 });
  });

  it('stores an expiry when one was given', async () => {
    const prisma = buildPrisma();
    const repo = new AnnouncementsRepository(prisma as any);

    await repo.createAnnouncement({
      title: 'Maintenance',
      description: 'Back at six',
      expiresAt: '2026-09-12T18:00:00.000Z',
    } as any);

    const data = prisma.model.announcement.create.mock.calls[0][0].data;
    expect(data.expiresAt).toEqual(new Date('2026-09-12T18:00:00.000Z'));
  });

  it('stores no expiry when none was given', async () => {
    const prisma = buildPrisma();
    const repo = new AnnouncementsRepository(prisma as any);

    await repo.createAnnouncement({
      title: 'Notice',
      description: 'Open ended',
    } as any);

    expect(prisma.model.announcement.create.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it('soft-deletes rather than removing the row', async () => {
    const prisma = buildPrisma();
    const repo = new AnnouncementsRepository(prisma as any);

    await expect(repo.deleteAnnouncement('a1')).resolves.toEqual({
      deleted: true,
    });

    const call = prisma.model.announcement.updateMany.mock.calls[0][0] as any;
    expect(call.where).toEqual({ id: 'a1', deletedAt: null });
    expect(call.data.deletedAt).toBeInstanceOf(Date);
  });

  it('says deleted:false for a row that was already gone', async () => {
    const prisma = buildPrisma();
    prisma.model.announcement.updateMany.mockResolvedValueOnce({ count: 0 });
    const repo = new AnnouncementsRepository(prisma as any);

    await expect(repo.deleteAnnouncement('missing')).resolves.toEqual({
      deleted: false,
    });
  });
});
