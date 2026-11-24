jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => {
  delete process.env.REDIS_URL;
  return jest.requireActual('@gitroom/nestjs-libraries/redis/redis.service');
});

import 'reflect-metadata';
import { TemporalMetadataAccessor } from 'nestjs-temporal-core';
import { PostActivity } from './post.activity';

// A token that dies hours before a scheduled post (a password change) was
// found only when the post failed: the check ran when someone opened the
// channel list. The hourly sweep now checks the channels of organisations with
// a post due in the next hours, while there is still time to reconnect.
describe('channel check before posting', () => {
  const build = (orgs: string[], failFor?: string) => {
    const checkIntegrationsHealth = jest.fn(async (org: string) => {
      if (org === failFor) throw new Error('platform down');
    });
    const organizationsWithPostsDueSoon = jest.fn().mockResolvedValue(orgs);
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _postService: { organizationsWithPostsDueSoon },
      _integrationService: { checkIntegrationsHealth },
    });
    return { activity, checkIntegrationsHealth, organizationsWithPostsDueSoon };
  };

  it('checks each organisation with a post due in the next 6 hours', async () => {
    const { activity, checkIntegrationsHealth, organizationsWithPostsDueSoon } = build(['o1', 'o2']);
    await activity.checkChannelsBeforePosting();
    expect(organizationsWithPostsDueSoon).toHaveBeenCalledWith(6);
    expect(checkIntegrationsHealth.mock.calls.map((c) => c[0])).toEqual(['o1', 'o2']);
  });

  it('one organisation failing does not skip the next', async () => {
    const { activity, checkIntegrationsHealth } = build(['o1', 'o2'], 'o1');
    await activity.checkChannelsBeforePosting();
    expect(checkIntegrationsHealth).toHaveBeenCalledTimes(2);
  });

  it('stops at its deadline instead of holding the sweep', async () => {
    const { activity, checkIntegrationsHealth } = build(['o1', 'o2']);
    await activity.checkChannelsBeforePosting(0);
    expect(checkIntegrationsHealth).not.toHaveBeenCalled();
  });

  it('an organisation whose platform never answers is left after its share of time, and the next is checked', async () => {
    const checkIntegrationsHealth = jest.fn((org: string) =>
      org === 'o1' ? new Promise<void>(() => undefined) : Promise.resolve()
    );
    const activity = Object.create(PostActivity.prototype) as any;
    Object.assign(activity, {
      _postService: { organizationsWithPostsDueSoon: jest.fn().mockResolvedValue(['o1', 'o2']) },
      _integrationService: { checkIntegrationsHealth },
    });
    await activity.checkChannelsBeforePosting(2_000, 20);
    expect(checkIntegrationsHealth.mock.calls.map((c) => c[0])).toEqual(['o1', 'o2']);
  });

  it('reaches the worker as an activity', () => {
    const accessor = new (TemporalMetadataAccessor as any)();
    const activity = Object.create(PostActivity.prototype);
    const { methods } = accessor.extractActivityMethods(activity);
    expect([...methods.keys()]).toContain('checkChannelsBeforePosting');
  });
});
