import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { SubscriptionService } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service';

@Injectable()
export class GrantLifetime {
  constructor(private _subscriptionService: SubscriptionService) {}

  @Command({
    command: 'grant-lifetime',
    describe:
      'Grant a lifetime Business subscription to the org(s) owned by an email (comped tester/influencer accounts - skips the paywall + trial guards). Dry-run unless --apply. Usage: grant-lifetime --email=user@example.com [--apply]',
  })
  async run() {
    const emailArg = process.argv.find((a) => a.startsWith('--email='));
    const email = emailArg ? emailArg.split('=').slice(1).join('=').trim() : '';
    if (!email) {
      console.error(
        '[grant-lifetime] missing --email=<address>. Usage: grant-lifetime --email=user@example.com [--apply]'
      );
      return false;
    }

    const apply = process.argv.includes('--apply');
    const report = await this._subscriptionService.grantLifetimeByEmail(
      email,
      apply
    );

    console.log(
      `[grant-lifetime] ${apply ? 'APPLY' : 'DRY-RUN'} - email "${
        report.email
      }", ${report.total} owned org(s)`
    );

    console.log(`[grant-lifetime] to grant (${report.granted.length}):`);
    for (const g of report.granted) {
      console.log(
        `  + ${g.name} (${g.id}) -> Business (lifetime), ${g.channels} channels`
      );
    }

    console.log(`[grant-lifetime] skipped (${report.skipped.length}):`);
    for (const s of report.skipped) {
      console.log(`  - ${s.name} (${s.id}): ${s.reason}`);
    }

    if (report.total === 0) {
      console.log(
        '[grant-lifetime] no org owned by that email - the user must be the org owner (SUPERADMIN). Check the address.'
      );
    }

    if (!apply) {
      console.log(
        '[grant-lifetime] DRY-RUN only - nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
