import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class BackfillGrantedScopes {
  constructor(private _integrationService: IntegrationService) {}

  @Command({
    command: 'backfill-granted-scopes',
    describe:
      'Ask Meta what each connected Facebook/Instagram token was actually granted and record it on the channel. Run once after the grantedScopes column ships - until then every existing channel reads as "no scopes" and loses first comment. Only writes grantedScopes. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const report = await this._integrationService.backfillGrantedScopes(apply);

    console.log(
      `[backfill-granted-scopes] ${apply ? 'APPLY' : 'DRY-RUN'} - ${
        report.length
      } Meta channel(s)`
    );

    for (const row of report) {
      if (row.error) {
        console.log(
          `  ! ${row.name} (${row.provider}) - could not read permissions: ${row.error}`
        );
        continue;
      }

      console.log(
        `  ${row.canComment ? '+' : '-'} ${row.name} (${row.provider}) - ${
          row.granted?.length ?? 0
        } scope(s), first comment ${row.canComment ? 'available' : 'not granted'}`
      );
    }

    if (!apply) {
      console.log(
        '[backfill-granted-scopes] DRY-RUN only - nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
