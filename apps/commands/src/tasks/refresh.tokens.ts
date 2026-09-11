import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class RefreshTokens {
  constructor(private _integrationService: IntegrationService) {}
  @Command({
    command: 'refresh',
    describe:
      'Refresh the tokens of every channel that is due one. Calls the providers, rewrites tokens, sets refreshNeeded and emails the owners of the channels that failed — so it is not read-only in any sense. Dry-run unless --apply.',
  })
  async refresh() {
    // Every other mutating command here defaults to a dry-run and wants
    // --apply. This one wrote immediately, so the muscle memory that the
    // commands in this directory are safe to run and read was wrong exactly
    // twice (E2E-09-44).
    const apply = process.argv.includes('--apply');
    const { total, refreshed, failed } =
      await this._integrationService.refreshTokens(apply);

    console.log(
      `[refresh] ${
        apply ? 'APPLY' : 'DRY-RUN'
      } — ${total} channel(s) due, ${refreshed.length} ${
        apply ? 'refreshed' : 'would be refreshed'
      }, ${failed.length} failed`
    );

    // "Due" means the token expires inside 24 hours, which for YouTube (about
    // an hour) and TikTok (23 hours) is the permanent steady state rather than
    // a problem — those refresh reactively on a 401 while publishing. Reported
    // apart, so the headline count stops reading as an incident: what an
    // operator acts on is a token already expired on a channel that no
    // scheduled workflow is watching (E2E-09-59).
    const expired = refreshed.filter((c) => (c.expiredFor ?? 0) > 0);
    const unwatched = expired.filter((c) => !c.scheduled);
    const hours = (seconds: number) => Math.round(seconds / 3600);

    console.log(
      `  already expired: ${expired.length}, of which not on a scheduled refresh: ${unwatched.length}`
    );
    for (const channel of expired) {
      console.log(
        `  ${channel.scheduled ? 'SCHEDULED' : 'REACTIVE '} ${
          channel.provider
        } expired ${hours(channel.expiredFor ?? 0)}h ago — ${channel.name}`
      );
    }
    if (!expired.length) {
      console.log(
        '  nothing is overdue — the rest expire within the next 24h, which is normal for short-lived tokens'
      );
    }

    // Printed per channel, because the loop used to stop at the first failure
    // and say nothing at all (E2E-09-43).
    for (const channel of failed) {
      console.log(`  FAILED ${channel.provider} ${channel.name} (${channel.id})`);
    }

    if (!apply) {
      console.log(
        '[refresh] DRY-RUN only — no provider was called and nothing was written. Re-run with --apply to refresh.'
      );
    }

    return true;
  }
}
