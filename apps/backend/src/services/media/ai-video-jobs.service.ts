import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

// Every minute each backend process looks for AI clips whose process was
// stopped (a deploy, a restart) and finishes them: see
// MediaService.resumeVideoJobs.
const EVERY_MS = 60_000;

@Injectable()
export class AiVideoJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(AiVideoJobsService.name);
  private _timer?: ReturnType<typeof setInterval>;

  constructor(private _mediaService: MediaService) {}

  onModuleInit() {
    this._timer = setInterval(() => {
      this._mediaService.resumeVideoJobs().catch((err) => {
        this._logger.warn(`AI video sweep failed: ${(err as Error)?.message}`);
      });
    }, EVERY_MS);
    this._timer.unref?.();
  }

  onModuleDestroy() {
    if (this._timer) {
      clearInterval(this._timer);
    }
  }
}
