/**
 * E2E-05-24 — missingPostWorkflow had never run on production (RUN_CRON was
 * unset). Before turning it on: one failed search after retries used to fail
 * the workflow for good, and the loop never continued-as-new.
 */
const search = jest.fn();
const continueAsNew = jest.fn().mockResolvedValue(undefined);
const sleep = jest.fn().mockResolvedValue(undefined);
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ searchForMissingThreeHoursPosts: search }),
  sleep: (...a: any[]) => sleep(...a),
  continueAsNew: (...a: any[]) => continueAsNew(...a),
}));

import { missingPostWorkflow } from './missing.post.workflow';

beforeEach(() => jest.clearAllMocks());

describe('missingPostWorkflow', () => {
  it('keeps going after a failed search', async () => {
    search.mockRejectedValueOnce(new Error('db down')).mockResolvedValue([]);
    await missingPostWorkflow();
    expect(search).toHaveBeenCalledTimes(24);
  });

  it('searches every hour, then hands over to a fresh run', async () => {
    search.mockResolvedValue([]);
    await missingPostWorkflow();
    expect(sleep).toHaveBeenCalledTimes(24);
    expect(sleep).toHaveBeenCalledWith('1 hour');
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });
});
