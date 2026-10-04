/**
 * Streak V2 (upstream 273c7b50): posts no longer kill and restart the
 * workflow; one run per organization ends the streak only when the last post
 * is a day old. Workflow time is simulated: `sleep` moves the clock.
 */
const DAY = 86_400_000;
let now = 0;
let lastPublish: number | null = null;
const setStreak = jest.fn().mockResolvedValue(undefined);
const getLastPublishDate = jest.fn(async () => lastPublish);
const continueAsNew = jest.fn().mockResolvedValue(undefined);
const handOver = jest.fn().mockResolvedValue(undefined);
const makeContinueAsNewFunc = jest.fn(() => handOver);
// Posts published while the workflow sleeps: [at, publishDate].
let schedule: [number, number][] = [];
const sleep = jest.fn(async (ms: number) => {
  const until = now + ms;
  for (const [at, published] of schedule) {
    if (at > now && at <= until) lastPublish = published;
  }
  now = until;
});

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ setStreak, getLastPublishDate }),
  sleep: (ms: number) => sleep(ms),
  continueAsNew: (...a: any[]) => continueAsNew(...a),
  makeContinueAsNewFunc: (...a: any[]) => (makeContinueAsNewFunc as any)(...a),
  patched: () => true,
}));

import { streakWorkflow, streakWorkflowV2 } from './streak.workflow';

beforeEach(() => {
  jest.clearAllMocks();
  now = 1_000_000;
  lastPublish = null;
  schedule = [];
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});
afterEach(() => jest.restoreAllMocks());

describe('streakWorkflowV2', () => {
  it('starts the streak and ends it a day after the only post', async () => {
    lastPublish = now;
    await streakWorkflowV2({ organizationId: 'o1' });
    expect(setStreak.mock.calls).toEqual([
      ['o1', 'start'],
      ['o1', 'end'],
    ]);
    expect(now).toBe(1_000_000 + DAY);
  });

  it('a post during the streak keeps it going until a day after that post', async () => {
    const start = now;
    lastPublish = start;
    schedule = [[start + 20 * 3_600_000, start + 20 * 3_600_000]];
    await streakWorkflowV2({ organizationId: 'o1' });
    expect(setStreak).toHaveBeenLastCalledWith('o1', 'end');
    expect(now).toBe(start + 20 * 3_600_000 + DAY);
  });

  it('an organization that posts every day continues as new after 30 checks', async () => {
    const start = now;
    lastPublish = start;
    schedule = Array.from({ length: 40 }, (_, d) => [start + (d + 1) * DAY - 1, start + (d + 1) * DAY - 1] as [number, number]);
    await streakWorkflowV2({ organizationId: 'o1' });
    expect(setStreak).not.toHaveBeenCalledWith('o1', 'end');
    expect(continueAsNew).toHaveBeenCalledWith({ organizationId: 'o1', lastPost: expect.any(Number) });
  });
});

describe('streakWorkflow (V1 runs alive at deploy time)', () => {
  it('hands over to V2 when the organization posted since it started', async () => {
    schedule = [[now + 3_600_000, now + 3_600_000]];
    await streakWorkflow({ organizationId: 'o1' });
    expect(makeContinueAsNewFunc).toHaveBeenCalledWith({ workflowType: 'streakWorkflowV2' });
    expect(handOver).toHaveBeenCalledWith({ organizationId: 'o1', lastPost: 1_000_000 + 3_600_000 });
    expect(setStreak).not.toHaveBeenCalledWith('o1', 'end');
  });

  it('still ends the streak when nothing was posted', async () => {
    await streakWorkflow({ organizationId: 'o1' });
    expect(setStreak).toHaveBeenLastCalledWith('o1', 'end');
    expect(handOver).not.toHaveBeenCalled();
  });
});
