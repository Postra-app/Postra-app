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
