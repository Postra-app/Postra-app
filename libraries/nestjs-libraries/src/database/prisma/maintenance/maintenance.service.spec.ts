import {
  DEFAULT_RETENTION,
  MaintenanceService,
} from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';

const removeFile = jest.fn();

jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ removeFile }) },
}));

interface Row {
  [key: string]: unknown;
}

/**
 * A stand-in for the client, narrow enough to make the reference scan's
 * queries obvious and wide enough that a missed one shows up as undefined
 * rather than as a silent pass.
 */
const buildPrisma = (data: {
  media?: Row[];
  post?: Row[];
  brandKit?: Row[];
  integration?: Row[];
  user?: Row[];
  socialMediaAgency?: Row[];
  oAuthApp?: Row[];
  errors?: number;
  auditLog?: number;
  aiUsage?: number;
  stripeProcessedEvent?: number;
  mobilePushToken?: number;
}) => {
  const deleted: Record<string, unknown[]> = {};

  const table = (rows: Row[] = []) => ({
    findMany: jest.fn(async ({ where }: any = {}) => {
      if (!where) {
        return rows;
      }
      return rows.filter((row) => {
        if (where.deletedAt === null) {
          return row.deletedAt == null;
        }
        if (where.deletedAt?.not === null) {
          if (row.deletedAt == null) {
            return false;
          }
          if (where.deletedAt.lt) {
            return (row.deletedAt as Date) < where.deletedAt.lt;
          }
          return true;
        }
        for (const [key, value] of Object.entries(where)) {
          if ((value as any)?.not === null && row[key] == null) {
            return false;
          }
        }
        return true;
      });
    }),
    count: jest.fn(async () => rows.length),
    deleteMany: jest.fn(async ({ where }: any) => {
      deleted.media = [...(deleted.media ?? []), where];
      return { count: rows.length };
    }),
  });

  const counted = (n = 0) => ({
    count: jest.fn(async () => n),
    deleteMany: jest.fn(async () => ({ count: n })),
    findMany: jest.fn(async () => []),
  });

  return {
    deleted,
    model: {
      media: table(data.media),
      post: table(data.post),
      brandKit: table(data.brandKit),
      integration: table(data.integration),
      user: table(data.user),
      socialMediaAgency: table(data.socialMediaAgency),
      oAuthApp: table(data.oAuthApp),
      errors: counted(data.errors),
      auditLog: counted(data.auditLog),
      aiUsage: counted(data.aiUsage),
      stripeProcessedEvent: counted(data.stripeProcessedEvent),
      mobilePushToken: counted(data.mobilePushToken),
    },
  };
};

const longAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

describe('purgeOldRecords', () => {
  it('counts and deletes nothing on a dry run', async () => {
    const prisma = buildPrisma({ errors: 7, auditLog: 3, aiUsage: 11 });
    const service = new MaintenanceService(prisma as any);

    const report = await service.purgeOldRecords(false);

    expect(report).toMatchObject({
      apply: false,
      errors: 7,
      auditLog: 3,
      aiUsage: 11,
    });
    expect(prisma.model.errors.deleteMany).not.toHaveBeenCalled();
    expect(prisma.model.auditLog.deleteMany).not.toHaveBeenCalled();
    expect(prisma.model.aiUsage.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the audit trail longer than the diagnostics', () => {
    // Accountability outlives troubleshooting: who granted what, to whom, from
    // which address has to answer a dispute months later.
    expect(DEFAULT_RETENTION.auditDays).toBeGreaterThan(
      DEFAULT_RETENTION.errorsDays
    );
  });

  it('deletes on apply', async () => {
    const prisma = buildPrisma({ errors: 2, auditLog: 0, aiUsage: 0 });
    const service = new MaintenanceService(prisma as any);

    await service.purgeOldRecords(true);

    expect(prisma.model.errors.deleteMany).toHaveBeenCalled();
    expect(prisma.model.auditLog.deleteMany).toHaveBeenCalled();
    expect(prisma.model.aiUsage.deleteMany).toHaveBeenCalled();
  });
});

// The Stripe webhook's record of handled events grew without
// a limit. A row only has to outlive the redeliveries: Stripe retries for 3
// days and the CLI resends up to 30 days after the event.
describe('handled Stripe events', () => {
  it('are kept longer than Stripe can resend them, and no longer than technical logs', () => {
    expect(DEFAULT_RETENTION.stripeEventsDays).toBeGreaterThan(30);
    expect(DEFAULT_RETENTION.stripeEventsDays).toBeLessThanOrEqual(
      DEFAULT_RETENTION.errorsDays
    );
  });

  it('are counted on a dry run and deleted on apply', async () => {
    const prisma = buildPrisma({ stripeProcessedEvent: 6 });
    const service = new MaintenanceService(prisma as any);

    expect(await service.purgeOldRecords(false)).toMatchObject({
      stripeEvents: 6,
    });
    expect(prisma.model.stripeProcessedEvent.deleteMany).not.toHaveBeenCalled();

    expect(await service.purgeOldRecords(true)).toMatchObject({
      stripeEvents: 6,
    });
    const cutoff = (prisma.model.stripeProcessedEvent.deleteMany.mock
      .calls[0] as any)[0].where.createdAt.lt as Date;
    const days = (Date.now() - cutoff.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(DEFAULT_RETENTION.stripeEventsDays);
  });
});

describe('sweepOrphanMedia', () => {
  beforeEach(() => removeFile.mockClear());

  it('removes the object behind a soft-deleted row nothing refers to', async () => {
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/gone.jpg',
          thumbnail: null,
          deletedAt: longAgo,
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.candidates).toBe(1);
    expect(report.stillReferenced).toBe(0);
    expect(report.removed).toBe(1);
    expect(removeFile).toHaveBeenCalledWith('uploads/gone.jpg');
  });

  it('leaves a file a scheduled post still holds', async () => {
    // This is the whole reason stored files could not be removed by calling
    // removeFile at the point of deletion: media deletion is soft because a
    // post can still be publishing the file.
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/in-use.jpg',
          thumbnail: null,
          deletedAt: longAgo,
        },
      ],
      post: [
        {
          id: 'p1',
          image: JSON.stringify([{ path: 'uploads/in-use.jpg' }]),
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.stillReferenced).toBe(1);
    expect(report.removed).toBe(0);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('leaves a file a post started using while the sweep ran', async () => {
    const prisma = buildPrisma({
      media: [
        { id: 'm1', path: 'uploads/reused.jpg', thumbnail: null, deletedAt: longAgo },
      ],
    });
    // The first reference scan sees no post; one is saved before the files go.
    const saved = { id: 'p1', image: JSON.stringify([{ path: 'uploads/reused.jpg' }]) };
    const scans = prisma.model.post.findMany;
    let calls = 0;
    scans.mockImplementation(async () => (calls++ === 0 ? [] : [saved]));
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(calls).toBeGreaterThan(1);
    expect(report.removed).toBe(0);
    expect(report.stillReferenced).toBe(1);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('leaves a file that is still somebody avatar', async () => {
    const prisma = buildPrisma({
      media: [
        {
          id: 'm-avatar',
          path: 'uploads/face.jpg',
          thumbnail: null,
          deletedAt: longAgo,
        },
      ],
      user: [{ id: 'u1', pictureId: 'm-avatar' }],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.stillReferenced).toBe(1);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('leaves a file a Studio project was built from', async () => {
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/layer.png',
          thumbnail: null,
          deletedAt: longAgo,
        },
        {
          id: 'project',
          path: 'uploads/project.png',
          thumbnail: null,
          deletedAt: null,
          canvasJson: '{"objects":[{"src":"uploads/layer.png"}]}',
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.stillReferenced).toBe(1);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('leaves a row still inside its grace period', async () => {
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/yesterday.jpg',
          thumbnail: null,
          deletedAt: new Date(),
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.candidates).toBe(0);
    expect(removeFile).not.toHaveBeenCalled();
  });

  it('touches nothing on a dry run but still reports what it would remove', async () => {
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/gone.jpg',
          thumbnail: 'uploads/gone-thumb.jpg',
          deletedAt: longAgo,
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(false);

    expect(report.removed).toBe(2);
    expect(removeFile).not.toHaveBeenCalled();
    expect(prisma.model.media.deleteMany).not.toHaveBeenCalled();
  });

  it('counts a failed removal instead of throwing', async () => {
    removeFile.mockRejectedValueOnce(new Error('S3 said no'));
    const prisma = buildPrisma({
      media: [
        {
          id: 'm1',
          path: 'uploads/stuck.jpg',
          thumbnail: null,
          deletedAt: longAgo,
        },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report.failed).toBe(1);
    expect(report.removed).toBe(0);
  });

  // Deleting the row of a file that could not be removed left the file in the
  // bucket with nothing pointing at it, so no later run could find it.
  it('keeps the row of a file it could not remove, deletes the others', async () => {
    removeFile.mockImplementation(async (path: string) => {
      if (path === 'uploads/stuck.jpg') throw new Error('S3 said no');
    });
    const prisma = buildPrisma({
      media: [
        { id: 'm1', path: 'uploads/stuck.jpg', thumbnail: null, deletedAt: longAgo },
        { id: 'm2', path: 'uploads/gone.jpg', thumbnail: null, deletedAt: longAgo },
      ],
    });
    const service = new MaintenanceService(prisma as any);

    const report = await service.sweepOrphanMedia(true);

    expect(report).toMatchObject({ removed: 1, failed: 1 });
    expect(prisma.deleted.media).toEqual([{ id: { in: ['m2'] } }]);
    removeFile.mockReset();
  });
});

// The privacy policy says technical logs are kept up to 90 days; audit and
// billing usage records up to 13 months.
describe('retention matches the privacy policy', () => {
  it('keeps error logs 90 days', () => {
    expect(DEFAULT_RETENTION.errorsDays).toBe(90);
  });

  // "Up to 13 months" is a promise, not an approximation: 400 days outlived
  // every 13-month span by days. The shortest 13 months in
  // the calendar decide, and housekeeping runs once a day, so a row can be
  // one day older than its window before it goes.
  it('never keeps audit and AI usage records past 13 months', () => {
    const shortest13Months = Math.min(
      ...Array.from({ length: 366 * 4 }, (_, i) => {
        const start = new Date(Date.UTC(2026, 0, 1 + i));
        const end = new Date(start);
        end.setUTCMonth(end.getUTCMonth() + 13);
        return Math.round((end.getTime() - start.getTime()) / 86_400_000);
      })
    );
    expect(DEFAULT_RETENTION.auditDays + 1).toBeLessThanOrEqual(shortest13Months);
    expect(DEFAULT_RETENTION.aiUsageDays + 1).toBeLessThanOrEqual(shortest13Months);
  });
});

// The privacy policy keeps a phone's push token "until you sign
// out of the app or delete your Postra account". A reinstalled or abandoned
// app never signs out, so its token stayed for good (production 2026-10-27: 70
// tokens for 3 people, 47 not seen for over 30 days). The app refreshes its
// token on every launch and a session lasts at most 30 days: a
// token not refreshed for longer belongs to a session that has ended.
describe('push tokens of ended sessions', () => {
  it('are deleted once not refreshed for 30 days', async () => {
    const prisma = buildPrisma({ mobilePushToken: 47 });
    const service = new MaintenanceService(prisma as any);

    const report = await service.purgeOldRecords(true);

    expect(report.pushTokens).toBe(47);
    const where = prisma.model.mobilePushToken.deleteMany.mock.calls[0][0].where;
    const days = (Date.now() - where.updatedAt.lt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(30);
  });

  it('are only counted on a dry run', async () => {
    const prisma = buildPrisma({ mobilePushToken: 5 });
    const report = await new MaintenanceService(prisma as any).purgeOldRecords(false);
    expect(report.pushTokens).toBe(5);
    expect(prisma.model.mobilePushToken.deleteMany).not.toHaveBeenCalled();
  });
});

// The agent's chat memory lives in Mastra's own tables, keyed by
// the organisation id with no foreign key, so deleting an account left the
// conversations of its organisations behind (production 2026-10-27: 3 threads, 18
// messages of organisations that no longer exist). The policy deletes content
// within 30 days of account deletion.
describe('agent chat memory of deleted organisations', () => {
  const rawPrisma = (tablesExist: boolean, orphans: number) => {
    const executed: string[] = [];
    return {
      executed,
      model: {
        $queryRawUnsafe: jest.fn(async (sql: string) =>
          sql.includes('to_regclass')
            ? [{ ok: tablesExist }]
            : [{ n: orphans }]
        ),
        $executeRawUnsafe: jest.fn(async (sql: string) => {
          executed.push(sql);
          return orphans;
        }),
      },
    };
  };

  it('deletes messages, threads and working memory of organisations that are gone', async () => {
    const prisma = rawPrisma(true, 3);
    const removed = await new MaintenanceService(prisma as any).purgeOrphanAgentMemory(true);
    expect(removed).toBe(3);
    const sql = prisma.executed.join('\n');
    expect(sql).toMatch(/DELETE FROM mastra_messages/);
    expect(sql).toMatch(/DELETE FROM mastra_threads/);
    expect(sql).toMatch(/DELETE FROM mastra_resources/);
    // Every delete is bounded by "no such organisation".
    for (const statement of prisma.executed) {
      expect(statement).toMatch(/NOT EXISTS \(SELECT 1 FROM "Organization"/);
    }
  });

  it('only counts on a dry run', async () => {
    const prisma = rawPrisma(true, 3);
    await expect(
      new MaintenanceService(prisma as any).purgeOrphanAgentMemory(false)
    ).resolves.toBe(3);
    expect(prisma.executed).toEqual([]);
  });

  it('does nothing where the agent never created its tables', async () => {
    const prisma = rawPrisma(false, 0);
    await expect(
      new MaintenanceService(prisma as any).purgeOrphanAgentMemory(true)
    ).resolves.toBe(0);
    expect(prisma.executed).toEqual([]);
  });
});
