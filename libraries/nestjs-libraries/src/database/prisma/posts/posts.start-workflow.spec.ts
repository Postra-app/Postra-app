jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PostsService } from './posts.service';

// A post whose workflow could not be started (Temporal unreachable for a
// moment) is saved and shown as scheduled, and goes out only when the hourly
// sweep for missed posts finds it after its time. The failure itself was
// swallowed without a word, so nothing told an operator why a post was late.
const build = (start: jest.Mock) => {
  const raw = {
    workflow: {
      list: () => (async function* () {})(),
      start,
    },
  };
  const temporal = { client: { getRawClient: () => raw, getWorkflowHandle: jest.fn() } };
  const deps: any[] = [{}, {}, {}, {}, {}, {}, temporal, {}];
  return new PostsService(...(deps as [any, any, any, any, any, any, any, any]));
};

describe('starting the publish workflow', () => {
  it('a failed start is logged with the post, and the save still succeeds', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const service = build(jest.fn().mockRejectedValue(new Error('14 UNAVAILABLE: connection refused')));
    await expect(service.startWorkflow('x', 'p1', 'o1', 'QUEUE')).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('p1'));
    expect(error.mock.calls.flat().join(' ')).toContain('UNAVAILABLE');
    error.mockRestore();
  });

  it('a draft starts nothing', async () => {
    const start = jest.fn();
    await build(start).startWorkflow('x', 'p1', 'o1', 'DRAFT');
    expect(start).not.toHaveBeenCalled();
  });
});
