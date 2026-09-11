import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

@Injectable()
export class EncryptTokens {
  constructor(private _integrationService: IntegrationService) {}
  @Command({
    command: 'encrypt-tokens',
    describe:
      'One-off: encrypt at rest any integration tokens still stored as plaintext. Idempotent — a value already carrying the enc:: marker is returned unchanged. Dry-run unless --apply.',
  })
  async encrypt() {
    const apply = process.argv.includes('--apply');
    const result = await this._integrationService.backfillTokenEncryption(
      apply
    );

    console.log(
      `[encrypt-tokens] ${apply ? 'APPLY' : 'DRY-RUN'} — ${result.updated}/${
        result.total
      } integrations ${apply ? 'encrypted' : 'would be encrypted'}.`
    );

    if (!apply) {
      console.log(
        '[encrypt-tokens] DRY-RUN only — nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
