import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

@Injectable()
export class BackfillMediaType {
  constructor(private _mediaService: MediaService) {}

  @Command({
    command: 'backfill-media-type',
    describe:
      'Set Media.type to "video" on the rows that hold a video. The column defaulted to "image" for every row ever written, videos included, because saveFile never set it — so the library and the video picker had to guess from the filename and could not filter in the database. Only writes type. Dry-run unless --apply.',
  })
  async run() {
    const apply = process.argv.includes('--apply');
    const { scanned, videos } = await this._mediaService.backfillMediaType(
      apply
    );

    console.log(
      `[backfill-media-type] ${
        apply ? 'APPLY' : 'DRY-RUN'
      } — ${scanned} row(s) not marked as video, ${videos.length} of them are`
    );

    for (const row of videos) {
      console.log(`  ${row.id} ${row.path}`);
    }

    if (!apply) {
      console.log(
        '[backfill-media-type] DRY-RUN only — nothing written. Re-run with --apply to persist.'
      );
    }

    return true;
  }
}
