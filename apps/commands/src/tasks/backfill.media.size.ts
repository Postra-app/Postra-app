import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

@Injectable()
export class BackfillMediaSize {
  constructor(private _mediaService: MediaService) {}

  @Command({
    command: 'backfill-media-size',
    describe:
      'Set Media.fileSize from the stored file on the rows that still hold 0. The column existed but nothing wrote it, so the media library could not count against the plan\'s media storage. Reads each file\'s size from storage (a HEAD request); a file that is gone stays at 0. Only writes fileSize. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const { checked, found, bytes } = await this._mediaService.backfillFileSize(apply);

    console.log(
      `[backfill-media-size] ${apply ? 'APPLY' : 'DRY-RUN'} - ${checked} row(s) without a size, ${found} found in storage, ${bytes} byte(s) in total`
    );

    if (!apply) {
      console.log(
        '[backfill-media-size] DRY-RUN only - nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
