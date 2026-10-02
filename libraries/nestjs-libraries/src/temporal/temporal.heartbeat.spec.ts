let ctx: any;
jest.mock('@temporalio/activity', () => {
  const actual = jest.requireActual('@temporalio/activity');
  return {
    ...actual,
    Context: {
      current: () => {
        if (!ctx) throw new Error('not in an activity');
        return ctx;
      },
    },
  };
});

import { ApplicationFailure, CancelledFailure } from '@temporalio/activity';
import {
  afterPublishing,
  markPublishing,
  setHeartbeatDetails,
  withHeartbeat,
} from './temporal.heartbeat';

const newContext = () => ({
  info: { activityType: 'postSocial' },
  heartbeat: jest.fn(),
  cancellationSignal: new AbortController().signal,
});

beforeEach(() => {
  ctx = newContext();
});

describe('markPublishing', () => {
  it('heartbeats at once with the publishing marker, not at the next tick', () => {
    markPublishing('mastodon');
    expect(ctx.heartbeat).toHaveBeenCalledWith('publish: mastodon');
  });

  it('refuses to publish when Temporal already cancelled the attempt', () => {
    const abort = new AbortController();
    abort.abort();
    ctx.cancellationSignal = abort.signal;

    expect(() => markPublishing('mastodon')).toThrow(CancelledFailure);
    expect(ctx.heartbeat).not.toHaveBeenCalled();
  });

  it('does nothing outside an activity', () => {
    ctx = undefined;
    expect(() => markPublishing('mastodon')).not.toThrow();
  });
});

describe('afterPublishing', () => {
  it('passes errors from before publishing through (safe to retry)', () => {
    const err = new Error('connection to the database lost');
    expect(afterPublishing(err)).toBe(err);
  });

  it('turns an untyped error after publishing into a non-retryable unknown outcome', () => {
    markPublishing('mastodon');
    const out = afterPublishing(new Error('The operation was aborted due to timeout'));

    expect(out).toBeInstanceOf(ApplicationFailure);
    expect((out as ApplicationFailure).type).toBe('publish_unknown');
    expect((out as ApplicationFailure).nonRetryable).toBe(true);
    expect((out as ApplicationFailure).message).toBe('The operation was aborted due to timeout');
  });

  it("keeps the provider's own typed failure", () => {
    markPublishing('mastodon');
    const badBody = ApplicationFailure.create({ type: 'bad_body', nonRetryable: true });
    expect(afterPublishing(badBody)).toBe(badBody);
  });
});

describe('withHeartbeat', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('marks entry, then resends the latest details every 15 s until done', async () => {
    let finish!: () => void;
    const running = withHeartbeat(() => new Promise<void>((r) => (finish = r)));

    jest.advanceTimersByTime(15_000);
    expect(ctx.heartbeat).toHaveBeenLastCalledWith('postSocial: entered');

    setHeartbeatDetails('uploading media');
    jest.advanceTimersByTime(15_000);
    expect(ctx.heartbeat).toHaveBeenLastCalledWith('uploading media');

    finish();
    await running;
    const calls = ctx.heartbeat.mock.calls.length;
    jest.advanceTimersByTime(60_000);
    expect(ctx.heartbeat).toHaveBeenCalledTimes(calls);
  });
});
