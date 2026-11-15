import {
  appleSandboxAllowedFor,
  appleStateOf,
  appleTierOf,
} from '@gitroom/nestjs-libraries/services/apple/apple.iap';
import { planLimits, TRIAL_LIMITS } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

const NOW = Date.UTC(2026, 10, 20);
const DAY = 86_400_000;
const tx = (over: Record<string, unknown> = {}) => ({
  originalTransactionId: '2000000000000001',
  productId: 'uk.co.postra.app.pro.monthly',
  purchaseDate: NOW - DAY,
  expiresDate: NOW + 29 * DAY,
  ...over,
});

describe('App Store product ids', () => {
  it('map to the three plans sold on the web and to nothing else', () => {
    expect(appleTierOf('uk.co.postra.app.starter.monthly')).toBe('STANDARD');
    expect(appleTierOf('uk.co.postra.app.pro.monthly')).toBe('PRO');
    expect(appleTierOf('uk.co.postra.app.business.monthly')).toBe('ULTIMATE');
    expect(appleTierOf('uk.co.postra.app.team.monthly')).toBeNull();
    expect(appleTierOf('__proto__')).toBeNull();
    expect(appleTierOf(undefined)).toBeNull();
  });
});

describe('appleStateOf', () => {
  it('a paid period in force is the plan of its product, not a trial', () => {
    expect(appleStateOf(tx(), { autoRenewStatus: 1 }, NOW)).toEqual({
      state: 'active',
      tier: 'PRO',
      isTrailing: false,
      cancelAt: null,
      periodAnchor: new Date(NOW - DAY),
    });
  });

  it('the free week is a trial, with the limits a web trial has', () => {
    const state = appleStateOf(tx({ offerDiscountType: 'FREE_TRIAL' }), undefined, NOW);
    expect(state).toMatchObject({ state: 'active', tier: 'PRO', isTrailing: true });
    const limits = planLimits('PRO', true);
    expect(limits.posts_per_month).toBe(TRIAL_LIMITS.posts_per_month);
    expect(limits.team_members).toBe(TRIAL_LIMITS.team_members);
    expect(limits.webhooks).toBe(TRIAL_LIMITS.webhooks);
    expect(limits.autoPostLimit).toBe(TRIAL_LIMITS.autoPostLimit);
    expect(limits.media_storage_gb).toBe(TRIAL_LIMITS.media_storage_gb);
  });

  it('auto-renew turned off ends the plan with the paid period', () => {
    const state = appleStateOf(tx(), { autoRenewStatus: 0 }, NOW);
    expect(state).toMatchObject({
      state: 'active',
      cancelAt: Math.floor((NOW + 29 * DAY) / 1000),
    });
  });

  it('a lapsed period has ended', () => {
    expect(appleStateOf(tx({ expiresDate: NOW - 1 }), { autoRenewStatus: 1 }, NOW)).toEqual({
      state: 'ended',
      reason: 'expired',
    });
  });

  it('a failed payment keeps the plan while the grace period runs, and no longer', () => {
    const lapsed = tx({ expiresDate: NOW - DAY });
    expect(
      appleStateOf(lapsed, { gracePeriodExpiresDate: NOW + 2 * DAY }, NOW)
    ).toMatchObject({ state: 'active', tier: 'PRO' });
    expect(
      appleStateOf(lapsed, { gracePeriodExpiresDate: NOW - 1 }, NOW)
    ).toEqual({ state: 'ended', reason: 'expired' });
  });

  it('a refund or a revoke ends it whatever the dates say', () => {
    expect(appleStateOf(tx({ revocationDate: NOW - 1000 }), undefined, NOW)).toEqual({
      state: 'ended',
      reason: 'revoked',
    });
  });

  it('a product this server does not sell grants nothing', () => {
    expect(appleStateOf(tx({ productId: 'other.app.gold' }), undefined, NOW)).toEqual({
      state: 'ended',
      reason: 'unknown-product',
    });
  });
});

describe('appleSandboxAllowedFor', () => {
  const before = process.env.APPLE_IAP_SANDBOX_ORGS;
  afterEach(() => {
    if (before === undefined) delete process.env.APPLE_IAP_SANDBOX_ORGS;
    else process.env.APPLE_IAP_SANDBOX_ORGS = before;
  });

  it('nobody unless named', () => {
    delete process.env.APPLE_IAP_SANDBOX_ORGS;
    expect(appleSandboxAllowedFor('org-1')).toBe(false);
    process.env.APPLE_IAP_SANDBOX_ORGS = 'org-2, org-3';
    expect(appleSandboxAllowedFor('org-1')).toBe(false);
    expect(appleSandboxAllowedFor('org-3')).toBe(true);
  });

  it('everyone on a test stack', () => {
    process.env.APPLE_IAP_SANDBOX_ORGS = '*';
    expect(appleSandboxAllowedFor('org-1')).toBe(true);
  });
});
