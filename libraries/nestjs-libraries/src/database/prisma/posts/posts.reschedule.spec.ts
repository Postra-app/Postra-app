jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PostsService } from './posts.service';

const build = (post: Record<string, unknown>) => {
  const repository = {
    getPostById: jest.fn().mockResolvedValue({ id: 'p1', group: 'g1', integration: { providerIdentifier: 'x' }, ...post }),
    changeDate: jest.fn().mockResolvedValue({}),
    changeState: jest.fn().mockResolvedValue({}),
    clearReleases: jest.fn().mockResolvedValue({}),
    clearGroupReleases: jest.fn().mockResolvedValue({}),
  };
  const service = new PostsService(repository as any, ...(Array.from({ length: 11 }, () => ({})) as [any]));
  const startWorkflow = jest.spyOn(service, 'startWorkflow').mockResolvedValue(undefined as any);
  return { service, repository, startWorkflow };
};

// POSTS-7: a new date sent without action 'schedule' was saved, but the
// workflow kept sleeping until the old time and published then.
describe('moving a post to another date', () => {
  it('reaches the workflow of a post still waiting to go out', async () => {
    const { service, startWorkflow } = build({ state: 'QUEUE', releaseId: null });
    await service.changeDate('o1', 'p1', '2099-01-02T10:00:00Z');
    expect(startWorkflow).toHaveBeenCalledWith('x', 'p1', 'o1', 'QUEUE');
  });

  it('only moves a published post on the calendar', async () => {
    const { service, startWorkflow } = build({ state: 'PUBLISHED', releaseId: 'r1' });
    await service.changeDate('o1', 'p1', '2099-01-02T10:00:00Z');
    expect(startWorkflow).not.toHaveBeenCalled();
  });
});

// POSTS-8: a republish through the public API re-queued the post, and the
// publish guard returned the saved release instead of publishing again.
describe('republishing through the public API', () => {
  it('clears the saved release so the post really goes out again', async () => {
    const { service, repository } = build({ state: 'PUBLISHED', releaseId: 'r1' });
    await service.changePostStatus('o1', 'p1', 'schedule', true);
    // The whole thread, comments included (Codex review).
    expect(repository.clearGroupReleases).toHaveBeenCalledWith('o1', 'g1');
  });

  it('moving a post back to draft keeps its release', async () => {
    const { service, repository } = build({ state: 'QUEUE', releaseId: null });
    await service.changePostStatus('o1', 'p1', 'draft');
    expect(repository.clearGroupReleases).not.toHaveBeenCalled();
  });
});
