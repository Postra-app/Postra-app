/**
 * The hourly autopost loop never continued-as-new: its history grew until
 * Temporal terminated the feed (upstream 185044d5).
 */
const autoPost = jest.fn().mockResolvedValue(undefined);
const continueAsNew = jest.fn().mockResolvedValue(undefined);
// A loop that never hands over would spin forever here: fail it instead.
const sleep = jest.fn(async () => {
  if (sleep.mock.calls.length > 48) throw new Error('never handed over to a fresh run');
});
let history = 10;
jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ autoPost }),
  sleep: (...a: any[]) => sleep(...a),
  continueAsNew: (...a: any[]) => continueAsNew(...a),
  patched: () => true,
  workflowInfo: () => ({ historyLength: history }),
  log: { error: jest.fn() },
}));

import { autoPostWorkflow } from './autopost.workflow';

beforeEach(() => {
  jest.clearAllMocks();
  history = 10;
});

describe('autoPostWorkflow', () => {
  it('runs every hour for a day, then hands over to a fresh run', async () => {
    await autoPostWorkflow({ id: 'a1', immediately: true });
    expect(autoPost).toHaveBeenCalledTimes(24);
    expect(sleep).toHaveBeenCalledTimes(24);
    expect(continueAsNew).toHaveBeenCalledWith({ id: 'a1', immediately: true });
  });

  it('hands over early when the history is already long', async () => {
    history = 1500;
    await autoPostWorkflow({ id: 'a1', immediately: false });
    expect(autoPost).not.toHaveBeenCalled();
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });

  it('a failed run does not end the feed', async () => {
    autoPost.mockRejectedValueOnce(new Error('feed down'));
    await autoPostWorkflow({ id: 'a1', immediately: true });
    expect(autoPost).toHaveBeenCalledTimes(24);
    expect(continueAsNew).toHaveBeenCalledTimes(1);
  });
});
