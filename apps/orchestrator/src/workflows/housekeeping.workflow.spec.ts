/**
 * The daily housekeeping run: retention + media sweep, then the margin guard
 * (behind a patch, see housekeeping.workflow.replay.spec.ts), a day of sleep
 * and continue-as-new. One step failing must not skip the other.
 */
const purgeOldRecords = jest.fn();
const checkAiMargins = jest.fn();
const sleep = jest.fn().mockResolvedValue(undefined);
const continueAsNew = jest.fn().mockResolvedValue(undefined);
let patchedResult = true;
const patched = jest.fn((_id: string) => patchedResult);

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ purgeOldRecords, checkAiMargins }),
  sleep: (...a: any[]) => sleep(...a),
  continueAsNew: (...a: any[]) => continueAsNew(...a),
  patched: (id: string) => patched(id),
}));

import { housekeepingWorkflow } from './housekeeping.workflow';

beforeEach(() => {
  patchedResult = true;
  purgeOldRecords.mockResolvedValue({});
  checkAiMargins.mockResolvedValue({});
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
    patchedResult = false;
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
});
