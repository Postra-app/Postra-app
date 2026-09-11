import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { ErrorsService } from '@gitroom/nestjs-libraries/database/prisma/errors/errors.service';

@Injectable()
export class ScrubErrorSecrets {
  constructor(private _errorsService: ErrorsService) {}

  @Command({
    command: 'scrub-error-secrets',
    describe:
      'Remove plaintext channel credentials from the Errors table. A failed publish used to write the whole in-flight post list into Errors.body, full Integration row included, so rows written before the fix hold working tokens for the providers that refresh them (Instagram, YouTube). Only rewrites message and body on the rows that still carry one. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const { scanned, dirty } = await this._errorsService.scrubSecrets(apply);

    console.log(
      `[scrub-error-secrets] ${
        apply ? 'APPLY' : 'DRY-RUN'
      } — ${scanned} row(s) scanned, ${dirty.length} still carrying credentials`
    );

    const byPlatform = dirty.reduce<Record<string, number>>((acc, row) => {
      acc[row.platform] = (acc[row.platform] || 0) + 1;
      return acc;
    }, {});

    for (const [platform, count] of Object.entries(byPlatform).sort(
      (a, b) => b[1] - a[1]
    )) {
      console.log(`  ${platform}: ${count}`);
    }

    if (!apply) {
      console.log(
        '[scrub-error-secrets] DRY-RUN only — nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
