import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import { MaintenanceService } from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';

@Injectable()
@Activity()
export class HousekeepingActivity {
  private readonly _logger = new Logger(HousekeepingActivity.name);
  constructor(private _maintenance: MaintenanceService) {}

  // What `purge-old-records --apply` does, with its default windows. It
  // existed as a command only and nothing ran it, so rows outlived their
  // retention and files deleted on 2026-09-10 were still on the CDN on
  // 2026-10-04 (E2E-06-01).
  @ActivityMethod()
  async purgeOldRecords() {
    const purge = await this._maintenance.purgeOldRecords(true);
    const sweep = await this._maintenance.sweepOrphanMedia(true);
    this._logger.log(
      `housekeeping: rows deleted Errors ${purge.errors}, AuditLog ${purge.auditLog}, AiUsage ${purge.aiUsage}; media objects removed ${sweep.removed}${sweep.failed ? `, failed ${sweep.failed}` : ''}`
    );
    return { ...purge, removed: sweep.removed, failed: sweep.failed };
  }
}
