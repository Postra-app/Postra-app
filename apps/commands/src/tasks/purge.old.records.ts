import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import {
  DEFAULT_RETENTION,
  MaintenanceService,
  RetentionWindows,
} from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';

// Read as `--errors-days=365`. yargs is not given the flags because every
// command here reads process.argv directly: an unknown flag makes yargs, via
// nestjs-command, refuse the whole command with "Unknown argument", which is
// also why --apply has to sit behind the `--` separator.
const numberFlag = (name: string, fallback: number) => {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) {
    return fallback;
  }
  const parsed = Number.parseInt(arg.slice(prefix.length), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

@Injectable()
export class PurgeOldRecords {
  constructor(private _maintenance: MaintenanceService) {}

  @Command({
    command: 'purge-old-records',
    describe:
      'Housekeeping. Drops Errors, AuditLog and AiUsage rows past their retention window, then removes stored objects behind media rows that were soft-deleted long enough ago and that nothing refers to any more. Three tables had no retention at all and the bucket kept every deleted upload (E2E-06-01). Windows: --errors-days, --audit-days, --ai-usage-days, --media-grace-days. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const windows: RetentionWindows = {
      errorsDays: numberFlag('errors-days', DEFAULT_RETENTION.errorsDays),
      auditDays: numberFlag('audit-days', DEFAULT_RETENTION.auditDays),
      aiUsageDays: numberFlag('ai-usage-days', DEFAULT_RETENTION.aiUsageDays),
      mediaGraceDays: numberFlag(
        'media-grace-days',
        DEFAULT_RETENTION.mediaGraceDays
      ),
    };

    const mode = apply ? 'APPLY' : 'DRY-RUN';
    console.log(
      `[purge-old-records] ${mode} — retention: errors ${windows.errorsDays}d, audit ${windows.auditDays}d, ai-usage ${windows.aiUsageDays}d, media grace ${windows.mediaGraceDays}d`
    );

    const purge = await this._maintenance.purgeOldRecords(apply, windows);
    console.log(
      `  rows ${apply ? 'deleted' : 'to delete'}: Errors ${purge.errors}, AuditLog ${
        purge.auditLog
      }, AiUsage ${purge.aiUsage}`
    );

    const sweep = await this._maintenance.sweepOrphanMedia(
      apply,
      windows.mediaGraceDays
    );
    console.log(
      `  media past grace: ${sweep.candidates} row(s); still referenced, left alone: ${sweep.stillReferenced}`
    );
    console.log(
      `  objects ${apply ? 'removed' : 'to remove'}: ${sweep.removed}${
        sweep.failed ? `, failed: ${sweep.failed}` : ''
      }`
    );

    if (!apply) {
      console.log(
        '[purge-old-records] DRY-RUN only — nothing deleted. Re-run with -- --apply to persist.'
      );
    }

    return true;
  }
}
