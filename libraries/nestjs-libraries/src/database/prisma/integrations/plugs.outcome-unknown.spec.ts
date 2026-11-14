/**
 * A plug comments or reposts in public. An error with no verdict from the
 * platform (a lost answer, a timeout) leaves the outcome unknown, and the
 * activity used to be retried: a second comment under the customer's post.
 * Such an error now leaves as publish_unknown, which is not retried; the
 * platform's own verdicts pass through as they were.
 */
let ctx: any;
jest.mock('@temporalio/activity', () => {
  const actual = jest.requireActual('@temporalio/activity');
  return { ...actual, Context: { current: () => ctx } };
});
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import { ApplicationFailure } from '@temporalio/activity';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';

const channel = {
  id: 'c1',
  providerIdentifier: 'x',
  disabled: false,
  deletedAt: null as Date | null,
};
const service = (plug: jest.Mock) => {
  const s = Object.create(IntegrationService.prototype) as IntegrationService;
  Object.assign(s, {
    _integrationRepository: {
      getPlug: jest.fn().mockResolvedValue({
        activated: true,
        plugFunction: 'autoPlugPost',
        data: '[]',
        integration: channel,
      }),
      getIntegrationById: jest.fn().mockResolvedValue(channel),
    },
    _integrationManager: {
      getSocialIntegration: () => ({ autoPlugPost: plug, comment: plug }),
      getInternalPlugs: () => ({
        internalPlugs: [{ identifier: 'comment', methodName: 'comment' }],
      }),
    },
  });
  return s;
};
const run = {
  plugId: 'pl1',
  postId: '9',
  delay: 0,
  totalRuns: 3,
  currentRun: 1,
};
const internal = {
  post: '9',
  originalIntegration: 'c1',
  integration: 'c2',
  plugName: 'comment',
  orgId: 'org-1',
  delay: 0,
  information: {},
};

beforeEach(() => {
  ctx = {
    info: { activityType: 'processPlug' },
    heartbeat: jest.fn(),
    cancellationSignal: new AbortController().signal,
  };
});

describe('a plug that fails with no answer from the platform', () => {
  it.each([
    ['of the channel itself', (s: IntegrationService) => s.processPlugs(run)],
    [
      'from another channel',
      (s: IntegrationService) => s.processInternalPlug(internal),
    ],
  ])('%s is not retried', async (_name, call) => {
    const plug = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

    await expect(call(service(plug))).rejects.toMatchObject({
      type: 'publish_unknown',
      nonRetryable: true,
    });
    expect(plug).toHaveBeenCalledTimes(1);
  });

  it("keeps the platform's own verdict", async () => {
    const refresh = ApplicationFailure.create({
      type: 'refresh_token',
      message: 'expired',
    });

    await expect(
      service(jest.fn().mockRejectedValue(refresh)).processPlugs(run)
    ).rejects.toBe(refresh);
  });

  it('answers as before when the plug ran', async () => {
    await expect(
      service(jest.fn().mockResolvedValue(true)).processPlugs(run)
    ).resolves.toBe(true);
    await expect(
      service(jest.fn().mockResolvedValue(false)).processPlugs(run)
    ).resolves.toBe(false);
  });
});
