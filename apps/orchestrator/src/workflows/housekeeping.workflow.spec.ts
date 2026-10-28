/**
 * The daily housekeeping run: retention + media sweep, then the margin guard
 * (behind a patch; the deploy replays the live run, scripts/replay-histories.mjs), a day of sleep
 * and continue-as-new. One step failing must not skip the other.
 */
const purgeOldRecords = jest.fn();
const checkAiMargins = jest.fn();
const housekeepingStarted = jest.fn();
const housekeepingFinished = jest.fn();
const sleep = jest.fn().mockResolvedValue(undefined);
const continueAsNew = jest.fn().mockResolvedValue(undefined);
let patches: Record<string, boolean> = {};
const patched = jest.fn((id: string) => patches[id] ?? true);

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({
    purgeOldRecords,
    checkAiMargins,
    housekeepingStarted,
    housekeepingFinished,
  }),
  sleep: (...a: any[]) => sleep(...a),
  continueAsNew: (...a: any[]) => continueAsNew(...a),
  patched: (id: string) => patched(id),
}));

import { housekeepingWorkflow } from './housekeeping.workflow';

beforeEach(() => {
  patches = {};
  jest.clearAllMocks();
  purgeOldRecords.mockResolvedValue({});
  checkAiMargins.mockResolvedValue({});
  housekeepingStarted.mockResolvedValue('check-in-1');
  housekeepingFinished.mockResolvedValue(undefined);
});

describe('housekeepingWorkflow', () => {
  it('a new run purges, checks margins, sleeps a day and continues as new', async () => {
    await housekeepingWorkflow();
    expect(purgeOldRecords).toHaveBeenCalledTimes(1);
    expect(patched).toHaveBeenCalledWith('housekeeping-margin-guard');
    expect(checkAiMargins).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith('1 day');
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });

  it('a run started before the margin guard skips it and still continues as new', async () => {
    patches = { 'housekeeping-margin-guard': false };
    await housekeepingWorkflow();
    expect(purgeOldRecords).toHaveBeenCalledTimes(1);
    expect(checkAiMargins).not.toHaveBeenCalled();
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });

  it('a failed purge does not skip the margin guard, and the other way round', async () => {
    purgeOldRecords.mockRejectedValueOnce(new Error('db down'));
    await housekeepingWorkflow();
    expect(checkAiMargins).toHaveBeenCalledTimes(1);

    checkAiMargins.mockRejectedValueOnce(new Error('mail down'));
    await housekeepingWorkflow();
    expect(continueAsNew).toHaveBeenCalledTimes(2);
  });

  // Sentry's cron monitor (E2E-11-15): one check-in opened before the steps
  // and closed after them, "error" as soon as one step failed, and nothing
  // reported by a run that started before the check-in shipped.
  it('reports the day to the cron monitor: ok, or error when a step failed', async () => {
    await housekeepingWorkflow();
    expect(housekeepingStarted).toHaveBeenCalledTimes(1);
    expect(housekeepingFinished).toHaveBeenCalledWith('check-in-1', true);
    expect(housekeepingStarted.mock.invocationCallOrder[0]).toBeLessThan(
      purgeOldRecords.mock.invocationCallOrder[0]
    );
    expect(housekeepingFinished.mock.invocationCallOrder[0]).toBeLessThan(
      sleep.mock.invocationCallOrder[0]
    );

    checkAiMargins.mockRejectedValueOnce(new Error('mail down'));
    await housekeepingWorkflow();
    expect(housekeepingFinished).toHaveBeenLastCalledWith('check-in-1', false);

    purgeOldRecords.mockRejectedValueOnce(new Error('db down'));
    await housekeepingWorkflow();
    expect(housekeepingFinished).toHaveBeenLastCalledWith('check-in-1', false);
  });

  it('files the sweep could not remove make the day an error', async () => {
    purgeOldRecords.mockResolvedValueOnce({ removed: 3, failed: 2 });
    await housekeepingWorkflow();
    expect(housekeepingFinished).toHaveBeenLastCalledWith('check-in-1', false);
  });

  it('a failed report does not stop the day, and an old run does not report', async () => {
    housekeepingFinished.mockRejectedValueOnce(new Error('sentry down'));
    await housekeepingWorkflow();
    expect(sleep).toHaveBeenCalledWith('1 day');
    expect(continueAsNew).toHaveBeenCalledTimes(1);

    // The opening check-in failing (worker restarts, timeouts) must not end
    // the workflow before the work (Codex): the day runs, unreported.
    housekeepingStarted.mockRejectedValueOnce(new Error('sentry down'));
    await housekeepingWorkflow();
    expect(purgeOldRecords).toHaveBeenCalledTimes(2);
    expect(checkAiMargins).toHaveBeenCalledTimes(2);
    expect(housekeepingFinished).toHaveBeenCalledTimes(1);
    expect(continueAsNew).toHaveBeenCalledTimes(2);

    patches = { 'housekeeping-check-in': false };
    await housekeepingWorkflow();
    expect(housekeepingStarted).toHaveBeenCalledTimes(2);
    expect(housekeepingFinished).toHaveBeenCalledTimes(1);
    expect(purgeOldRecords).toHaveBeenCalledTimes(3);
    expect(continueAsNew).toHaveBeenCalledTimes(3);
  });
});
