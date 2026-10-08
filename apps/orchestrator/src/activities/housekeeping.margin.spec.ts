jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  const store = new Map<string, string>();
  return {
    ioRedis: {
      get: jest.fn(async (k: string) => store.get(k) ?? null),
      set: jest.fn(async (k: string, v: string) => {
        store.set(k, v);
        return 'OK';
      }),
      __store: store,
    },
  };
});
jest.mock('@gitroom/nestjs-libraries/database/prisma/maintenance/maintenance.service', () => ({
  MaintenanceService: class {},
}));

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { HousekeepingActivity } from './housekeeping.activity';

// Codex on -08-e: the "already mailed" mark was written before the mail went
// out, so a failed send lost the alert for the rest of the month.
const report = {
  days: 30,
  usdPerGbp: 1.34,
  threshold: 0.7,
  unknownModels: [] as string[],
  organizations: [
    { organizationId: 'o1', name: 'Bakery', tier: 'STANDARD', trial: false, planGbp: 19, costUsd: 19.5, share: 0.77, alert: true },
  ],
};

const activity = (send: jest.Mock) =>
  new HousekeepingActivity(
    {} as any,
    { marginReport: async () => report } as any,
    { sendEmailSync: send } as any,
    { user: { findMany: async () => [{ email: 'admin@example.com' }] } } as any
  );

describe('margin guard mail', () => {
  beforeEach(() => (ioRedis as any).__store.clear());

  it('marks an alert as sent only once the mail went out, and tries again after a failure', async () => {
    const failing = jest.fn(async () => false);
    await expect(activity(failing).checkAiMargins()).rejects.toThrow();
    expect((ioRedis as any).__store.size).toBe(0);

    const working = jest.fn(async () => true);
    await expect(activity(working).checkAiMargins()).resolves.toEqual({ alerts: 1 });
    expect(working).toHaveBeenCalledTimes(1);

    // Sent: not again this month.
    const again = jest.fn(async () => true);
    await expect(activity(again).checkAiMargins()).resolves.toEqual({ alerts: 0 });
    expect(again).not.toHaveBeenCalled();
  });
});
