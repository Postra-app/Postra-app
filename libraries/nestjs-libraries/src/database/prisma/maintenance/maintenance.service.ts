import { Injectable, Logger } from '@nestjs/common';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import dayjs from 'dayjs';

/**
 * Housekeeping that nothing else does.
 *
 * Two jobs that turned out to be the same job. Three tables grow without a
 * ceiling — a grep for a purge, a cron or a retention window across the whole
 * repository returns nothing — and the storage bucket keeps every object whose
 * media row was soft-deleted, which is every file a customer has ever removed
 * from their library (E2E-06-01, 05-gaps §5 #2).
 *
 * Deleting media is soft on purpose: a scheduled post can still be holding the
 * file, so `removeFile` at the point of deletion is the wrong answer and that
 * is why E2E-06-01 was not closed by adding one. What it needs is a sweeper
 * that checks whether anything still refers to the object, which is what this
 * does, and which only makes sense as a periodic job.
 *
 * Everything here is dry-run unless told otherwise, and the report says what
 * it would touch.
 */

export interface RetentionWindows {
  errorsDays: number;
  auditDays: number;
  aiUsageDays: number;
  /** How long a soft-deleted media row waits before its object is swept. */
  mediaGraceDays: number;
}

export const DEFAULT_RETENTION: RetentionWindows = {
  // The panel's widest named filter is 90 days; 180 keeps roughly two of those
  // for a diagnosis that reaches back, without keeping failures forever.
  errorsDays: 180,
  // Accountability records outlive diagnostics: who granted what, to whom,
  // from which address. Kept over a year so a dispute a year old can be
  // answered.
  auditDays: 400,
  aiUsageDays: 400,
  // A soft-deleted file is recoverable until this passes. Long enough that
  // "I deleted it by mistake" is answerable, short enough to bound the bucket.
  mediaGraceDays: 30,
};

export interface PurgeReport {
  apply: boolean;
  windows: RetentionWindows;
  errors: number;
  auditLog: number;
  aiUsage: number;
}

export interface SweepReport {
  apply: boolean;
  graceDays: number;
  candidates: number;
  /** Objects a live reference still points at, so they were left alone. */
  stillReferenced: number;
  removed: number;
  failed: number;
}

@Injectable()
export class MaintenanceService {
  constructor(
    private _prisma: PrismaRepository<
      | 'errors'
      | 'auditLog'
      | 'aiUsage'
      | 'media'
      | 'post'
      | 'brandKit'
      | 'integration'
      | 'user'
      | 'socialMediaAgency'
      | 'oAuthApp'
    >
  ) {}

  /**
   * Drop rows older than their retention window.
   *
   * Errors cascade with their organization and their post, so the rows this
   * removes are old failures of organizations that still exist. AuditLog and
   * AiUsage have no foreign key at all — they are the genuine orphans, and
   * they are also the two that must not be trimmed aggressively.
   */
  async purgeOldRecords(
    apply: boolean,
    windows: RetentionWindows = DEFAULT_RETENTION
  ): Promise<PurgeReport> {
    const cutoff = (days: number) => dayjs().subtract(days, 'day').toDate();

    const errorsWhere = { createdAt: { lt: cutoff(windows.errorsDays) } };
    const auditWhere = { createdAt: { lt: cutoff(windows.auditDays) } };
    const aiUsageWhere = { createdAt: { lt: cutoff(windows.aiUsageDays) } };

    if (!apply) {
      const [errors, auditLog, aiUsage] = await Promise.all([
        this._prisma.model.errors.count({ where: errorsWhere }),
        this._prisma.model.auditLog.count({ where: auditWhere }),
        this._prisma.model.aiUsage.count({ where: aiUsageWhere }),
      ]);
      return { apply, windows, errors, auditLog, aiUsage };
    }

    const [errors, auditLog, aiUsage] = await Promise.all([
      this._prisma.model.errors.deleteMany({ where: errorsWhere }),
      this._prisma.model.auditLog.deleteMany({ where: auditWhere }),
      this._prisma.model.aiUsage.deleteMany({ where: aiUsageWhere }),
    ]);

    return {
      apply,
      windows,
      errors: errors.count,
      auditLog: auditLog.count,
      aiUsage: aiUsage.count,
    };
  }

  /**
   * Remove stored objects behind media rows that nothing refers to any more.
   *
   * Conservative by construction: a candidate is skipped the moment any live
   * reference is found, and "I could not tell" counts as a reference. Deleting
   * an object that a scheduled post still needs is not recoverable, whereas
   * keeping one costs pennies.
   */
  async sweepOrphanMedia(
    apply: boolean,
    graceDays = DEFAULT_RETENTION.mediaGraceDays
  ): Promise<SweepReport> {
    const cutoff = dayjs().subtract(graceDays, 'day').toDate();

    const candidates = await this._prisma.model.media.findMany({
      where: { deletedAt: { not: null, lt: cutoff } },
      select: { id: true, path: true, thumbnail: true },
    });

    const report: SweepReport = {
      apply,
      graceDays,
      candidates: candidates.length,
      stillReferenced: 0,
      removed: 0,
      failed: 0,
    };

    if (!candidates.length) {
      return report;
    }

    const referenced = await this.collectLiveReferences();
    const storage = UploadFactory.createStorage();

    // A path can be shared between a media row and another row's thumbnail, so
    // work out the full set of objects to drop before touching the bucket.
    const keep = new Set<string>();
    const drop = new Map<string, string[]>();

    for (const row of candidates) {
      const paths = [row.path, row.thumbnail].filter(Boolean) as string[];
      const isReferenced =
        referenced.ids.has(row.id) ||
        paths.some((path) => referenced.paths.has(path));

      if (isReferenced) {
        report.stillReferenced++;
        for (const path of paths) {
          keep.add(path);
        }
        continue;
      }

      for (const path of paths) {
        drop.set(path, [...(drop.get(path) ?? []), row.id]);
      }
    }

    for (const path of keep) {
      drop.delete(path);
    }

    for (const path of drop.keys()) {
      if (!apply) {
        report.removed++;
        continue;
      }
      try {
        await storage.removeFile(path);
        report.removed++;
      } catch {
        report.failed++;
      }
    }

    if (apply && report.removed) {
      // The rows go too: keeping a soft-deleted row whose object is gone would
      // make the next run reconsider the same files forever.
      const sweptIds = [...new Set([...drop.values()].flat())];
      await this._prisma.model.media.deleteMany({
        where: { id: { in: sweptIds } },
      });
    }

    if (report.failed) {
      Logger.warn(
        `sweepOrphanMedia: ${report.failed} object(s) could not be removed`
      );
    }

    return report;
  }

  /**
   * Everything that could still be pointing at a stored object.
   *
   * By media id: a user's avatar, an agency logo, a brand kit logo, an OAuth
   * app picture — all declared `onDelete: SetNull`, which only fires on a hard
   * delete, so a soft-deleted row can still be somebody's profile picture.
   *
   * By path: a post's image list (client-controlled JSON holding ids, paths or
   * both), a brand kit logo path, a connected channel's picture URL, and the
   * live media rows themselves — a Studio project keeps the paths of the
   * pictures inside it in `canvasJson` and `designSpec`.
   */
  private async collectLiveReferences() {
    const ids = new Set<string>();
    const paths = new Set<string>();

    // Only the paths of removable rows matter, so collect those first and test
    // referring text against that set, rather than trying to parse every
    // format a path can appear in.
    const candidateRows = await this._prisma.model.media.findMany({
      where: { deletedAt: { not: null } },
      select: { path: true, thumbnail: true },
    });
    const pendingPaths = [
      ...new Set(
        candidateRows
          .flatMap((row) => [row.path, row.thumbnail])
          .filter(Boolean) as string[]
      ),
    ];

    // A substring match, deliberately blunt: a false positive keeps a file, a
    // false negative deletes one that is still in use.
    const addPathsFrom = (text: string | null | undefined) => {
      if (!text) {
        return;
      }
      for (const path of pendingPaths) {
        if (text.includes(path)) {
          paths.add(path);
        }
      }
    };

    const [users, agencies, oauthApps, brandKits] = await Promise.all([
      this._prisma.model.user.findMany({
        where: { pictureId: { not: null } },
        select: { pictureId: true },
      }),
      this._prisma.model.socialMediaAgency.findMany({
        where: { logoId: { not: null } },
        select: { logoId: true },
      }),
      this._prisma.model.oAuthApp.findMany({
        where: { pictureId: { not: null } },
        select: { pictureId: true },
      }),
      this._prisma.model.brandKit.findMany({
        select: { logoPath: true },
      }),
    ]);

    for (const row of users) {
      if (row.pictureId) ids.add(row.pictureId);
    }
    for (const row of agencies) {
      if (row.logoId) ids.add(row.logoId);
    }
    for (const row of oauthApps) {
      if (row.pictureId) ids.add(row.pictureId);
    }
    for (const row of brandKits) {
      addPathsFrom(row.logoPath);
    }

    // Posts, in batches: `image` is arbitrary JSON and there can be a lot of
    // them. Ids inside it are matched as text for the same reason.
    const POST_BATCH = 500;
    let postCursor: string | undefined;
    for (;;) {
      const posts = await this._prisma.model.post.findMany({
        select: { id: true, image: true },
        orderBy: { id: 'asc' },
        take: POST_BATCH,
        ...(postCursor ? { cursor: { id: postCursor }, skip: 1 } : {}),
      });
      if (!posts.length) {
        break;
      }
      postCursor = posts[posts.length - 1].id;
      for (const post of posts) {
        addPathsFrom(post.image);
        if (post.image) {
          for (const candidateId of extractIds(post.image)) {
            ids.add(candidateId);
          }
        }
      }
      if (posts.length < POST_BATCH) {
        break;
      }
    }

    // Live media rows: a Studio project holds the pictures it was built from.
    const LIVE_BATCH = 500;
    let mediaCursor: string | undefined;
    for (;;) {
      const live = await this._prisma.model.media.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          path: true,
          thumbnail: true,
          canvasJson: true,
          designSpec: true,
        },
        orderBy: { id: 'asc' },
        take: LIVE_BATCH,
        ...(mediaCursor ? { cursor: { id: mediaCursor }, skip: 1 } : {}),
      });
      if (!live.length) {
        break;
      }
      mediaCursor = live[live.length - 1].id;
      for (const row of live) {
        if (row.path) paths.add(row.path);
        if (row.thumbnail) paths.add(row.thumbnail);
        addPathsFrom(row.canvasJson);
        addPathsFrom(
          row.designSpec ? JSON.stringify(row.designSpec) : null
        );
      }
      if (live.length < LIVE_BATCH) {
        break;
      }
    }

    // Connected channels keep the avatar as a URL, which contains the path.
    const integrations = await this._prisma.model.integration.findMany({
      where: { picture: { not: null } },
      select: { picture: true },
    });
    for (const row of integrations) {
      addPathsFrom(row.picture);
    }

    return { ids, paths };
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Every uuid appearing in a blob of text — a post's image list holds them. */
const extractIds = (text: string): string[] => text.match(UUID) ?? [];
