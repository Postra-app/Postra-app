/**
 * MissingPostWorkflow had never run on production (RUN_CRON was
 * unset). Before turning it on: one failed search after retries used to fail
 * the workflow for good, and the loop never continued-as-new.
 */
const search = jest.fn();
const mockProxyOptions: unknown[] = [];
const check = jest.fn().mockResolvedValue(undefined);
const continueAsNew = jest.fn().mockResolvedValue(undefined);
const sleep = jest.fn().mockResolvedValue(undefined);
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: (opts: unknown) => (mockProxyOptions.push(opts), {
    searchForMissingThreeHoursPosts: search,
    checkChannelsBeforePosting: check,
  }),
  patched: () => true,
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

// Channels whose token died were found only when a post failed.
// Every hour the sweep also checks the channels of organisations with a post
// due soon; a failed check must not stop the sweep.
describe('missingPostWorkflow channel check', () => {
  it('checks channels every hour, after the search', async () => {
    search.mockResolvedValue([]);
    await missingPostWorkflow();
    expect(check).toHaveBeenCalledTimes(24);
  });

  it('keeps going after a failed check', async () => {
    search.mockResolvedValue([]);
    check.mockRejectedValueOnce(new Error('platform down'));
    await missingPostWorkflow();
    expect(search).toHaveBeenCalledTimes(24);
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });

  it('runs the check with one short try, apart from the search', () => {
    expect(mockProxyOptions).toContainEqual({
      startToCloseTimeout: '5 minute',
      retry: { maximumAttempts: 1 },
    });
  });
});

