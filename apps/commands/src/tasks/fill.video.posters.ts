import { Command } from 'nestjs-command';
import { Injectable } from '@nestjs/common';
import { MaintenanceService } from '@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service';

@Injectable()
export class FillVideoPosters {
  constructor(private _maintenance: MaintenanceService) {}

  @Command({
    command: 'fill-video-posters',
    describe:
      'Takes a poster frame (ffmpeg) for library videos without one, newest first, up to --limit=N (default 100). The daily housekeeping run does the same; this is for doing it now, e.g. right after the deploy that added posters.',
  })
  async run() {
    const arg = process.argv.find((v) => v.startsWith('--limit='));
    const parsed = arg ? Number.parseInt(arg.slice('--limit='.length), 10) : NaN;
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
    const report = await this._maintenance.fillVideoPosters(limit);
    console.log(JSON.stringify(report));
  }
}
