/**
 * The housekeeping run reports to Sentry's cron monitor "housekeeping"
 * (Postra-infra modules/sentry owns the monitor): one check-in opened as
 * in_progress, closed with the same id as ok or error.
 */
jest.mock('@sentry/nestjs', () => ({
  captureCheckIn: jest.fn(() => 'check-in-42'),
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock('@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service', () => ({
  MaintenanceService: class {},
}));

import * as Sentry from '@sentry/nestjs';
import { HOUSEKEEPING_MONITOR, HousekeepingActivity } from './housekeeping.activity';

const activity = () =>
  new HousekeepingActivity({} as any, {} as any, {} as any, {} as any);

describe('housekeeping check-in', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens an in_progress check-in and returns its id', async () => {
    await expect(activity().housekeepingStarted()).resolves.toBe('check-in-42');
    expect(Sentry.captureCheckIn).toHaveBeenCalledWith({
      monitorSlug: HOUSEKEEPING_MONITOR,
      status: 'in_progress',
    });
  });

  it('closes the same check-in as ok or error', async () => {
    await activity().housekeepingFinished('check-in-42', true);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: 'check-in-42',
      monitorSlug: HOUSEKEEPING_MONITOR,
      status: 'ok',
    });
    await activity().housekeepingFinished('check-in-42', false);
    expect(Sentry.captureCheckIn).toHaveBeenLastCalledWith({
      checkInId: 'check-in-42',
      monitorSlug: HOUSEKEEPING_MONITOR,
      status: 'error',
    });
  });

  it('the slug is the one the Terraform monitor uses', () => {
    expect(HOUSEKEEPING_MONITOR).toBe('housekeeping');
  });
});
