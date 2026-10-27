import * as Sentry from '@sentry/nestjs';
import { Logger } from '@nestjs/common';

// A backend that failed to start must exit. pm2 restarts a process that
// exits; one that only logged the error stays "online" with no port bound,
// the silent state of B0 (e2e/backend/01-boot-hang.md), until a watchdog
// replaces the container minutes later.
export const failBoot = async (
  error: unknown,
  exit: (code: number) => never = process.exit
) => {
  Logger.error(
    'Backend failed to start',
    error instanceof Error ? error.stack : String(error),
    'Bootstrap'
  );
  Sentry.captureException(error);
  await Sentry.flush(2000).catch(() => undefined);
  exit(1);
};
