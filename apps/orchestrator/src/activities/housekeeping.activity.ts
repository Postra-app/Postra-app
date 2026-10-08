import { Injectable, Logger } from '@nestjs/common';
import { Activity, ActivityMethod } from 'nestjs-temporal-core';
import dayjs from 'dayjs';
import { MaintenanceService } from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';
import { AiUsageService } from '@gitroom/nestjs-libraries/database/prisma/ai-usage/ai-usage.service';
import { EmailService } from '@gitroom/nestjs-libraries/services/email.service';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { marginAlertMail } from '@gitroom/nestjs-libraries/ai-cost/margin-alert.mail';

@Injectable()
@Activity()
export class HousekeepingActivity {
  private readonly _logger = new Logger(HousekeepingActivity.name);
  constructor(
    private _maintenance: MaintenanceService,
    private _aiUsage: AiUsageService,
    private _email: EmailService,
    private _prisma: PrismaService
  ) {}

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

  // The margin guard, daily: Postra administrators get one mail when an
  // organisation's AI cost passes 70% of its plan price, and one more past
  // 100% — at most once per level per organisation per month.
  @ActivityMethod()
  async checkAiMargins() {
    const report = await this._aiUsage.marginReport();
    const month = dayjs().format('YYYY-MM');
    const fresh = [];
    for (const row of report.organizations.filter((r) => r.alert)) {
      const level = row.share >= 1 ? 100 : 70;
      const first = await ioRedis.set(
        `margin-alert:${row.organizationId}:${month}:${level}`,
        '1',
        'EX',
        40 * 86_400,
        'NX'
      );
      if (first === 'OK') fresh.push(row);
    }
    if (!fresh.length) {
      return { alerts: 0 };
    }
    const admins = await this._prisma.user.findMany({
      where: { isSuperAdmin: true, activated: true },
      select: { email: true },
    });
    const { subject, html } = marginAlertMail(fresh, report);
    for (const admin of admins) {
      await this._email.sendEmailSync(admin.email, subject, html);
    }
    this._logger.log(`margin guard: ${fresh.length} organisation(s) over ${report.threshold * 100}%`);
    return { alerts: fresh.length };
  }
}
