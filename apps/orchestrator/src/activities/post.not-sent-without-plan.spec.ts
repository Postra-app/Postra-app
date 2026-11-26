jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

import { PostActivity } from './post.activity';

// A post scheduled during a trial for a time after it came due with no plan
// (the trial without a card had ended) and turned red as "No Post", with
// nothing said. Now it is marked not sent with the reason, and the customer
// is told how to send it.
const build = (subscription: unknown, post: unknown = { id: 'p1' }) => {
  const activity = Object.create(PostActivity.prototype) as any;
  const postService = { getPostById: jest.fn().mockResolvedValue(post), changeState: jest.fn().mockResolvedValue({}) };
  const notificationService = { inAppNotification: jest.fn().mockResolvedValue(undefined) };
  Object.assign(activity, {
    _subscriptionService: { getSubscription: jest.fn().mockResolvedValue(subscription) },
    _postService: postService,
    _notificationService: notificationService,
  });
  return { activity, postService, notificationService };
};

const key = process.env.STRIPE_SECRET_KEY;
const frontend = process.env.FRONTEND_URL;
beforeEach(() => {
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
  process.env.FRONTEND_URL = 'https://app.example.test';
});
afterAll(() => {
  process.env.STRIPE_SECRET_KEY = key;
  process.env.FRONTEND_URL = frontend;
});

describe('a post due with no plan', () => {
  it('is marked not sent with the reason, and the customer is told', async () => {
    const { activity, postService, notificationService } = build(null);

    expect(await activity.notSentWithoutPlan('org-1', 'p1')).toBe(true);

    expect(postService.changeState).toHaveBeenCalledWith(
      'p1',
      'ERROR',
      'Not sent: your Postra plan is not active. Choose a plan in Billing, then publish this post again.'
    );
    expect(notificationService.inAppNotification).toHaveBeenCalledWith(
      'org-1',
      'A scheduled post was not sent',
      'A post you scheduled was not sent because your Postra plan is not active: your free trial has ended or your plan was cancelled. The post is saved. Choose a plan in Billing (https://app.example.test/billing), then open the post and publish it again.',
      true,
      true,
      'info',
      undefined,
      'p1'
    );
  });

  it('with a plan, the post is simply gone: nothing is said', async () => {
    const { activity, postService, notificationService } = build({ subscriptionTier: 'PRO' });

    expect(await activity.notSentWithoutPlan('org-1', 'p1')).toBe(false);
    expect(postService.changeState).not.toHaveBeenCalled();
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });

  it('a post deleted meanwhile says nothing', async () => {
    const { activity, notificationService } = build(null, null);

    expect(await activity.notSentWithoutPlan('org-1', 'p1')).toBe(false);
    expect(notificationService.inAppNotification).not.toHaveBeenCalled();
  });

  it('without billing (self-hosted) there is no plan to miss', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { activity } = build(null);

    expect(await activity.notSentWithoutPlan('org-1', 'p1')).toBe(false);
  });
});
