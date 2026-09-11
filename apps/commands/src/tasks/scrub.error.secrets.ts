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

    // Two numbers, not one. The previous version said "N still carrying
    // credentials" for every row with a secret-named field, encrypted ones
    // included — on production that read 111 of 111 where the plaintext
    // exposure was about half, and an operator acts on the number they read.
    const withPlaintext = dirty.filter((row) => row.plaintext > 0);
    const plaintextFields = dirty.reduce((sum, row) => sum + row.plaintext, 0);
    const encryptedFields = dirty.reduce((sum, row) => sum + row.encrypted, 0);

    console.log(
      `[scrub-error-secrets] ${
        apply ? 'APPLY' : 'DRY-RUN'
      } — ${scanned} row(s) scanned, ${dirty.length} with a credential field`
    );
    console.log(
      `  leaking: ${withPlaintext.length} row(s), ${plaintextFields} plaintext field(s)`
    );
    console.log(
      `  encrypted at rest (redacted anyway, not a leak): ${encryptedFields} field(s)`
    );

    const byPlatform = withPlaintext.reduce<Record<string, number>>(
      (acc, row) => {
        acc[row.platform] = (acc[row.platform] || 0) + 1;
        return acc;
      },
      {}
    );

    if (withPlaintext.length) {
      console.log('  plaintext by platform:');
      for (const [platform, count] of Object.entries(byPlatform).sort(
        (a, b) => b[1] - a[1]
      )) {
        console.log(`    ${platform}: ${count}`);
      }
    }

    if (!apply) {
      console.log(
        '[scrub-error-secrets] DRY-RUN only — nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
