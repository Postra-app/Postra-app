import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

@Injectable()
export class GrandfatherSubscriptions {
  constructor(private _subscriptionService: SubscriptionService) {}

  @Command({
    command: 'grandfather-subscriptions',
    describe:
      'One-off, ALREADY RUN: grant every existing organization a lifetime Business subscription so nobody drops to FREE when Stripe billing is enabled. Not registered in command.module.ts — after launch this would comp the whole free tier, permanently. Dry-run unless --apply is passed.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const report = await this._subscriptionService.grandfatherAllOrganizations(
      apply
    );

    console.log(
      `[grandfather] ${apply ? 'APPLY' : 'DRY-RUN'} — ${
        report.total
      } organizations total`
    );

    console.log(`[grandfather] to grant (${report.granted.length}):`);
    for (const g of report.granted) {
      console.log(
        `  + ${g.name} (${g.id}) -> Business, ${g.channels} channels`
      );
    }

    console.log(`[grandfather] skipped (${report.skipped.length}):`);
    for (const s of report.skipped) {
      console.log(`  - ${s.name} (${s.id}): ${s.reason}`);
    }

    if (!apply) {
      console.log(
        '[grandfather] DRY-RUN only — nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
