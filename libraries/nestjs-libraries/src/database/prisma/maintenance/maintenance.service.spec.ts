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
    // This is the whole reason E2E-06-01 could not be closed by calling
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
});
