import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

@Injectable()
export class SyncChannelSlots {
  constructor(private _subscriptionService: SubscriptionService) {}

  @Command({
    command: 'sync-channel-slots',
    describe:
      'Raise totalChannels of active subscriptions to the current pricing quota (run after enabling a new channel globally). Never lowers, skips lifetime rows. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const report = await this._subscriptionService.syncChannelSlots(apply);

    console.log(
      `[sync-channel-slots] ${apply ? 'APPLY' : 'DRY-RUN'} - ${
        report.total
      } active subscription(s)`
    );

    console.log(`[sync-channel-slots] to update (${report.updated.length}):`);
    for (const u of report.updated) {
      console.log(`  + ${u.org} (${u.tier}): ${u.from} -> ${u.to} channels`);
    }

    console.log(
      `[sync-channel-slots] already current (${report.skipped.length}):`
    );
    for (const s of report.skipped) {
      console.log(`  - ${s.org} (${s.tier}): ${s.channels} channels`);
    }

    if (!apply) {
      console.log(
        '[sync-channel-slots] DRY-RUN only - nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
