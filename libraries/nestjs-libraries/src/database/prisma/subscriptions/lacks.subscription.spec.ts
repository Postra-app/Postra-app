import { lacksSubscription } from './lacks.subscription';

// E2E-08-48: the public API and MCP let in any organisation with a
// subscription row, whatever its plan's public_api flag said.
describe('public API and MCP access', () => {
  const key = process.env.STRIPE_PUBLISHABLE_KEY;
  beforeEach(() => (process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test'));
  afterAll(() => (process.env.STRIPE_PUBLISHABLE_KEY = key));

  it('lets in a plan that includes the API', () => {
    for (const tier of ['STANDARD', 'TEAM', 'PRO', 'ULTIMATE']) {
      expect(lacksSubscription({ subscription: { subscriptionTier: tier } })).toBe(false);
    }
  });

  it('refuses no subscription, and a plan without the API', () => {
    expect(lacksSubscription({ subscription: null })).toBe(true);
    expect(lacksSubscription(null)).toBe(true);
    expect(lacksSubscription({ subscription: { subscriptionTier: 'FREE' } })).toBe(true);
    expect(lacksSubscription({ subscription: { subscriptionTier: 'UNKNOWN' } })).toBe(true);
  });

  it('does not check without billing', () => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    expect(lacksSubscription({ subscription: { subscriptionTier: 'FREE' } })).toBe(false);
  });
});
