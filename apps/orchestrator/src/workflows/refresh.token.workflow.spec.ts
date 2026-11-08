/**
 * A channel on a scheduled refresh (Instagram without Facebook, Threads) gets
 * one workflow, started when it is connected, that sleeps until the stored
 * expiry and refreshes. The stored expiry is two days before the platform's.
 *
 * A refresh that failed on an outage leaves the channel connected and its
 * expiry unchanged, so the next loop found it already due, returned, and
 * nothing watched the channel any more: the token then died at the platform
 * and the customer had to reconnect. Workflow time is simulated: `sleep`
 * moves the clock.
 */
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let now = 0;
let integration: any;
const getIntegrationsById = jest.fn(async () => integration && { ...integration });
const refreshToken = jest.fn();
const advance = async (ms: number) => {
  now += ms;
  jest.setSystemTime(now);
};
const sleep = jest.fn(advance);

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: () => ({ getIntegrationsById, refreshToken }),
  sleep: (ms: number) => sleep(ms),
}));

import { refreshTokenWorkflow } from './refresh.token.workflow';

beforeEach(() => {
  jest.clearAllMocks();
  sleep.mockImplementation(advance);
  now = 1_000_000_000;
  jest.useFakeTimers({ doNotFake: ['setTimeout', 'setImmediate', 'nextTick'] });
  jest.setSystemTime(now);
  integration = { id: 'i1', tokenExpiration: new Date(now + 58 * DAY) };
});
afterEach(() => jest.useRealTimers());

const args = { integrationId: 'i1', organizationId: 'o1' };

it('refreshes at the stored expiry and goes back to sleep until the next one', async () => {
  let refreshes = 0;
  refreshToken.mockImplementation(async () => {
    refreshes++;
    if (refreshes === 2) integration = null; // removed: the workflow ends
    else integration.tokenExpiration = new Date(now + 58 * DAY);
    return { accessToken: 'a' };
  });
  await refreshTokenWorkflow(args);
  expect(refreshToken).toHaveBeenCalledTimes(2);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([58 * DAY, 58 * DAY]);
});

it('an outage at refresh time is tried again hourly, and the channel is renewed', async () => {
  let attempts = 0;
  refreshToken.mockImplementation(async () => {
    attempts++;
    if (attempts < 4) return false; // provider down, channel left connected
    integration.tokenExpiration = new Date(now + 58 * DAY);
    return { accessToken: 'a' };
  });
  // Renewed: the next sleep is the full term again; end the run after it.
  sleep.mockImplementation(async (ms: number) => {
    await advance(ms);
    if (ms === 58 * DAY && attempts >= 4) integration = null;
  });
  await refreshTokenWorkflow(args);
  expect(refreshToken).toHaveBeenCalledTimes(4);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([58 * DAY, HOUR, HOUR, HOUR, 58 * DAY]);
});

it('gives up before the platform expiry, so a dead refresh does not loop forever', async () => {
  refreshToken.mockResolvedValue(false);
  await refreshTokenWorkflow(args);
  const retries = sleep.mock.calls.filter(([ms]) => ms === HOUR).length;
  expect(retries).toBeGreaterThan(0);
  expect(retries * HOUR).toBeLessThan(2 * DAY);
});

it('stops once the channel is marked for reconnecting', async () => {
  refreshToken.mockImplementation(async () => {
    integration.refreshNeeded = true;
    return false;
  });
  await refreshTokenWorkflow(args);
  expect(refreshToken).toHaveBeenCalledTimes(1);
  expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([58 * DAY]);
});
