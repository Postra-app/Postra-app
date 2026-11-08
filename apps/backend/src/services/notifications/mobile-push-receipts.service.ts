import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MobilePushService } from '@gitroom/nestjs-libraries/database/prisma/mobile-push/mobile.push.service';

// Every minute a backend process reads the receipts of pushes sent 15 minutes
// earlier, by the backend or the workers: MobilePushService.checkReceipts.
const EVERY_MS = 60_000;

@Injectable()
export class MobilePushReceiptsService implements OnModuleInit, OnModuleDestroy {
  private readonly _logger = new Logger(MobilePushReceiptsService.name);
  private _timer?: ReturnType<typeof setInterval>;

  constructor(private _mobilePush: MobilePushService) {}

  onModuleInit() {
    this._timer = setInterval(() => {
      this._mobilePush.checkReceipts().catch((err) => {
        this._logger.warn(`Push receipts check failed: ${(err as Error)?.message}`);
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
