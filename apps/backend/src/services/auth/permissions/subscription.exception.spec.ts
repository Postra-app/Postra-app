import { getErrorMessage, SubscriptionExceptionFilter } from './subscription.exception';
import {
  AuthorizationActions,
  PermissionDeniedException,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// Regression guard. getErrorMessage used to switch on
// four quota sections with no default, so a denial on ADMIN / AI / AUTOPOST /
// TEAM_MEMBERS returned undefined — JSON.stringify dropped the key and the
// client got `{statusCode: 402, url}` with nothing to show the user.
describe('permission denials', () => {
  it('never maps a section to undefined', () => {
    for (const section of Object.values(Sections)) {
      for (const action of Object.values(AuthorizationActions)) {
        const message = getErrorMessage({ section, action });
        expect(typeof message).toBe('string');
        expect(message!.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the quota wording that names the limit that was hit', () => {
    expect(getErrorMessage({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
    })).toContain('channels');
    expect(getErrorMessage({
      section: Sections.WEBHOOKS,
      action: AuthorizationActions.Create,
    })).toContain('webhooks');
  });

  it('tells an Auto Post denial how many feeds each plan holds, not "not in your plan"', () => {
    const message = getErrorMessage({
      section: Sections.AUTOPOST,
      action: AuthorizationActions.Create,
    });
    expect(message).toContain('Starter (2 RSS feeds), Pro (3) and Business (10)');
  });

  // Authority vs entitlement: money fixes one and not the other, so they must
  // not share a status code.
  it('answers 403 for a role denial and 402 for a plan limit', () => {
    const denial = { action: AuthorizationActions.Create } as const;
    expect(
      new PermissionDeniedException({ ...denial, section: Sections.ADMIN }).getStatus()
    ).toBe(403);
    expect(
      new SubscriptionException({ ...denial, section: Sections.CHANNEL }).getStatus()
    ).toBe(402);
  });
});

// Billing is for admins (BILLING_ADMIN), so a 402 that sent a plain member to
// "Go to billing" led to a page they cannot use. A web session says whether
// the member can act on it; API key and OAuth requests carry no member.
describe('who can act on a 402', () => {
  const run = (org: any) => {
    const json = jest.fn();
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ org }),
      }),
    };
    new SubscriptionExceptionFilter().catch(
      new SubscriptionException({ section: Sections.CHANNEL, action: AuthorizationActions.Create }),
      host
    );
    return json.mock.calls[0][0];
  };

  it('tells the page a plain member cannot open billing', () => {
    expect(run({ users: [{ role: 'USER' }] }).canManageBillingUi).toBe(false);
  });

  it('lets admins and the owner go to billing', () => {
    expect(run({ users: [{ role: 'ADMIN' }] }).canManageBillingUi).toBe(true);
    expect(run({ users: [{ role: 'SUPERADMIN' }] }).canManageBillingUi).toBe(true);
  });

  it('adds nothing when there is no member (API key, OAuth)', () => {
    expect(run(undefined)).not.toHaveProperty('canManageBillingUi');
  });
});

// A trial limit says it is the trial's, how much the plan has, and
// how to get it, instead of "upgrade your subscription" to someone who
// already picked the plan.
describe('a limit reached during the free trial', () => {
  const run = (section: Sections, org: any = { isTrailing: true, subscription: { subscriptionTier: 'STANDARD' }, users: [{ role: 'SUPERADMIN' }] }) => {
    const json = jest.fn();
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status: () => ({ json }) }),
        getRequest: () => ({ org }),
      }),
    };
    new SubscriptionExceptionFilter().catch(new SubscriptionException({ section, action: AuthorizationActions.Create }), host);
    return json.mock.calls[0][0];
  };

  it.each([
    [Sections.CHANNEL, 'Your free trial includes 2 channels. Your Starter plan includes 4 channels. End the trial to start your plan now.'],
    [Sections.POSTS_PER_MONTH, 'Your free trial includes 15 posts. Your Starter plan includes 400 posts a month. End the trial to start your plan now.'],
    [Sections.WEBHOOKS, 'Your free trial includes 1 webhook. Your Starter plan includes 2 webhooks. End the trial to start your plan now.'],
    [Sections.AUTOPOST, 'Your free trial includes 1 Auto Post feed. Your Starter plan includes 2 Auto Post feeds. End the trial to start your plan now.'],
    [Sections.VIDEOS_PER_MONTH, 'Your free trial includes 1 AI video. Your Starter plan includes 15 AI videos a month. End the trial to start your plan now.'],
    [Sections.TEAM_MEMBERS, 'The free trial is for one person. Team invites open with a plan that has team seats: Pro has 2, Business has 5.'],
  ])('%s', (section, message) => {
    const body = run(section);
    expect(body.message).toBe(message);
    expect(body.trial).toBe(true);
  });

  it('a Business trial calls its 10 000 webhooks unlimited, as the plan pages do', () => {
    const body = run(Sections.WEBHOOKS, { isTrailing: true, subscription: { subscriptionTier: 'ULTIMATE' }, users: [{ role: 'ADMIN' }] });
    expect(body.message).toBe('Your free trial includes 1 webhook. Your Business plan includes unlimited webhooks. End the trial to start your plan now.');
  });

  it('a Pro trial names Pro, and an unlimited allowance as unlimited', () => {
    const body = run(Sections.POSTS_PER_MONTH, { isTrailing: true, subscription: { subscriptionTier: 'PRO' }, users: [{ role: 'ADMIN' }] });
    expect(body.message).toBe('Your free trial includes 15 posts. Your Pro plan includes unlimited posts. End the trial to start your plan now.');
  });

  it('a paid plan keeps the upgrade wording', () => {
    const body = run(Sections.CHANNEL, { isTrailing: false, subscription: { subscriptionTier: 'STANDARD' }, users: [{ role: 'ADMIN' }] });
    expect(body.message).toContain('Please upgrade your subscription');
    expect(body).not.toHaveProperty('trial');
  });
});
