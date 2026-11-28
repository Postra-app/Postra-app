jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: {} }));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.repository',
  () => ({ SubscriptionRepository: class {} })
);

import { AppleIapService } from '@gitroom/nestjs-libraries/services/apple/apple.iap.service';

const DAY = 86_400_000;
const ID = '2000000000000001';
const ORG = 'org-1';
// The organisation may still have a free trial (the rule of the app's plan list).
const TRIAL = { trialAllowed: true };
const NO_TRIAL = { trialAllowed: false };

// A purchase as Apple signs it, dated around the real clock: the service
// reads "now" itself.
const tx = (over: Record<string, unknown> = {}) => ({
  originalTransactionId: ID,
  productId: 'uk.co.postra.app.pro.monthly',
  purchaseDate: Date.now() - DAY,
  expiresDate: Date.now() + 29 * DAY,
  signedDate: Date.now(),
  environment: 'Production',
  ...over,
});

const build = (opts: {
  transaction?: any;
  notification?: any;
  invalid?: boolean;
  owner?: any;
  current?: any;
  done?: boolean;
  endedAt?: Date | null;
  paymentId?: string | null;
} = {}) => {
  const verifier = {
    transaction: opts.invalid
      ? jest.fn().mockRejectedValue(new Error('bad signature'))
      : jest.fn().mockResolvedValue(opts.transaction ?? tx()),
    notification: opts.invalid
      ? jest.fn().mockRejectedValue(new Error('bad signature'))
      : jest.fn().mockResolvedValue(opts.notification),
  };
  const done = new Set<string>(opts.done ? ['uuid-1'] : []);
  const store = {
    isDone: jest.fn(async (id: string) => done.has(id)),
    markDone: jest.fn(async (id: string) => void done.add(id)),
    lease: jest.fn().mockResolvedValue(true),
    release: jest.fn().mockResolvedValue(undefined),
    endedAt: jest.fn().mockResolvedValue(opts.endedAt ?? null),
    markEnded: jest.fn().mockResolvedValue(undefined),
  };
  const openCheckouts = { expire: jest.fn().mockResolvedValue(0) };
  const subscriptions = {
    createOrUpdateSubscription: jest.fn().mockResolvedValue(undefined),
    endAppleSubscription: jest.fn().mockResolvedValue({ revoked: true }),
  };
  const repository = {
    findByAppleTransaction: jest.fn().mockResolvedValue(opts.owner ?? null),
    releaseEndedAppleTransaction: jest.fn().mockResolvedValue(true),
    getSubscriptionByOrgId: jest.fn().mockResolvedValue(opts.current ?? null),
    getPaymentId: jest.fn().mockResolvedValue(opts.paymentId ?? null),
    listLapsedApple: jest.fn().mockResolvedValue([]),
  };
  const service = new AppleIapService(
    verifier as any,
    store as any,
    subscriptions as any,
    repository as any,
    openCheckouts as any
  );
  return { service, verifier, store, subscriptions, repository, openCheckouts };
};

const written = (subscriptions: any) => {
  const [isTrailing, identifier, customerId, channels, tier, period, cancelAt, code, org, anchor, comp, apple] =
    subscriptions.createOrUpdateSubscription.mock.calls[0];
  return { isTrailing, identifier, customerId, channels, tier, period, cancelAt, code, org, anchor, comp, apple };
};

const notification = (type: string, subtype?: string, over: any = {}) => ({
  notificationType: type,
  subtype,
  notificationUUID: 'uuid-1',
  signedDate: Date.now(),
  transaction: tx(),
  renewal: { autoRenewStatus: 1 },
  ...over,
});
const owner = (over: any = {}) => ({
  id: 'sub-1',
  organizationId: ORG,
  deletedAt: null,
  appleSignedAt: new Date(Date.now() - DAY),
  ...over,
});

describe('AppleIapService', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.APPLE_IAP_ENABLED = '1';
    delete process.env.APPLE_IAP_SANDBOX_ORGS;
  });
  afterAll(() => {
    process.env = env;
  });

  describe('switched off', () => {
    it('answers 404 and touches nothing', async () => {
      delete process.env.APPLE_IAP_ENABLED;
      const { service, verifier } = build();
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 404 });
      await expect(service.notify('a.b.c')).rejects.toMatchObject({ status: 404 });
      expect(verifier.transaction).not.toHaveBeenCalled();
      expect(verifier.notification).not.toHaveBeenCalled();
    });
  });

  describe('attach (the purchase from the app)', () => {
    it('writes the plan of the product for the organisation, addressed without a Stripe customer', async () => {
      const { service, subscriptions } = build();
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).resolves.toEqual({
        ok: true,
        tier: 'PRO',
        isTrailing: false,
      });
      expect(written(subscriptions)).toMatchObject({
        isTrailing: false,
        identifier: ID,
        customerId: '',
        channels: 8,
        tier: 'PRO',
        period: 'MONTHLY',
        cancelAt: null,
        code: undefined,
        org: ORG,
        comp: undefined,
        apple: { originalTransactionId: ID },
      });
      // The end of the paid period, for housekeeping to end it if Apple's
      // expiry notification never comes.
      expect(written(subscriptions).apple.expiresAt).toBeInstanceOf(Date);
    });

    it('the free week is written as a trial, so the web trial limits apply', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ offerDiscountType: 'FREE_TRIAL' }),
      });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(written(subscriptions).isTrailing).toBe(true);
    });

    it('refuses what the App Store did not sign', async () => {
      const { service, subscriptions } = build({ invalid: true });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 400 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('refuses a test-environment purchase for an organisation that is not named', async () => {
      const { service, subscriptions } = build({ transaction: tx({ environment: 'Sandbox' }) });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 403 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('takes a test-environment purchase for a named organisation', async () => {
      process.env.APPLE_IAP_SANDBOX_ORGS = `other,${ORG}`;
      const { service, subscriptions } = build({ transaction: tx({ environment: 'Sandbox' }) });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(subscriptions.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    });

    it('refuses an expired or refunded purchase', async () => {
      for (const over of [{ expiresDate: Date.now() - 1 }, { revocationDate: Date.now() - 1 }]) {
        const { service, subscriptions } = build({ transaction: tx(over) });
        await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
        expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      }
    });

    it('one purchase pays for one organisation: a second one is refused', async () => {
      const { service, subscriptions, repository } = build({
        owner: owner({ organizationId: 'org-other' }),
      });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(repository.releaseEndedAppleTransaction).not.toHaveBeenCalled();
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('a purchase whose plan ended elsewhere may move', async () => {
      const { service, subscriptions, repository } = build({
        owner: owner({ organizationId: 'org-other', deletedAt: new Date(), appleSignedAt: null }),
      });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(repository.releaseEndedAppleTransaction).toHaveBeenCalledWith(ID);
      expect(written(subscriptions).org).toBe(ORG);
    });

    it('refuses when a plan is already in force from Stripe, a comp or a lifetime grant', async () => {
      const { service, subscriptions } = build({
        current: { id: 'sub-9', appleOriginalTransactionId: null },
      });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('the same purchase again (restore purchases) is written again, not refused', async () => {
      const { service, subscriptions } = build({
        owner: owner(),
        current: { id: 'sub-1', appleOriginalTransactionId: ID },
      });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(subscriptions.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    });

    // After a refund the transaction the app first received is still
    // validly signed and not yet expired.
    it('refuses a transaction signed before Apple said the purchase was over', async () => {
      const signedDate = Date.now() - 3 * DAY;
      for (const owner of [null, { id: 's', organizationId: 'org-other', deletedAt: new Date(), appleSignedAt: new Date() }]) {
        const { service, subscriptions, repository } = build({
          transaction: tx({ signedDate }),
          endedAt: new Date(Date.now() - DAY),
          owner,
        });
        await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
        expect(repository.releaseEndedAppleTransaction).not.toHaveBeenCalled();
        expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      }
    });

    it('takes a transaction signed after it (the same Apple ID subscribed again)', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ signedDate: Date.now() }),
        endedAt: new Date(Date.now() - DAY),
      });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(subscriptions.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    });

    it('holds the organisation as well as the purchase, and lets both go', async () => {
      const { service, store } = build();
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(store.lease.mock.calls.map((c: any[]) => c[0])).toEqual([ID, `org:${ORG}`]);
      expect(store.release.mock.calls.map((c: any[]) => c[0]).sort()).toEqual([ID, `org:${ORG}`].sort());
    });

    it('a second purchase for the organisation waits its turn; refused if the first is still running', async () => {
      const { service, store, subscriptions } = build();
      store.lease.mockImplementation(async (of: string) => !of.startsWith('org:'));
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(store.release).toHaveBeenCalledWith(ID, expect.any(String));
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('closes Stripe checkouts the organisation left open, after the plan is written', async () => {
      const { service, openCheckouts, subscriptions } = build({ paymentId: 'cus_1' });
      await service.attach(ORG, 'a.b.c', TRIAL);
      expect(openCheckouts.expire).toHaveBeenCalledWith('cus_1');
      expect(subscriptions.createOrUpdateSubscription.mock.invocationCallOrder[0]).toBeLessThan(
        openCheckouts.expire.mock.invocationCallOrder[0]
      );
    });

    it('a failure to close them does not undo the purchase', async () => {
      const { service, openCheckouts } = build({ paymentId: 'cus_1' });
      openCheckouts.expire.mockRejectedValue(new Error('stripe down'));
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).resolves.toMatchObject({ ok: true });
    });

    it('answers 409 while another write of the purchase is running', async () => {
      const { service, store, subscriptions } = build();
      store.lease.mockResolvedValue(false);
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    // Security review: the purchase is bound to the
    // organisation it was bought for.
    it('refuses a purchase bought for another organisation (appAccountToken)', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ appAccountToken: '7d0f5a52-1111-4c3e-9a51-0e3b2d5c9f10' }),
      });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('takes a purchase bought for this organisation, whatever the case of the token', async () => {
      const org = '7d0f5a52-1111-4c3e-9a51-0e3b2d5c9f10';
      const { service, subscriptions } = build({
        transaction: tx({ appAccountToken: org.toUpperCase() }),
      });
      await expect(service.attach(org, 'a.b.c', TRIAL)).resolves.toMatchObject({ ok: true });
      expect(written(subscriptions).org).toBe(org);
    });

    it('refuses a family member\'s shared copy of a purchase', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ inAppOwnershipType: 'FAMILY_SHARED' }),
      });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).rejects.toMatchObject({ status: 409 });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('takes the buyer\'s own purchase (PURCHASED)', async () => {
      const { service } = build({ transaction: tx({ inAppOwnershipType: 'PURCHASED' }) });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).resolves.toMatchObject({ ok: true });
    });

    it('takes a purchase with no token (an offer code redeemed in the App Store)', async () => {
      const { service } = build({ transaction: tx() });
      await expect(service.attach(ORG, 'a.b.c', TRIAL)).resolves.toMatchObject({ ok: true });
    });

    // One trial, wherever it is taken: a free week bought by an organisation
    // whose trial is spent is refused, as the plan list would not offer it.
    it('refuses the free week for an organisation that has had its trial', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ offerDiscountType: 'FREE_TRIAL' }),
      });
      await expect(service.attach(ORG, 'a.b.c', NO_TRIAL)).rejects.toMatchObject({
        status: 409,
        message: 'This account has already had its free trial.',
      });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('a paid period is taken even when the trial is spent', async () => {
      const { service } = build({ transaction: tx() });
      await expect(service.attach(ORG, 'a.b.c', NO_TRIAL)).resolves.toMatchObject({ ok: true });
    });

    it('the free week already tied to this organisation may be restored', async () => {
      const { service, subscriptions } = build({
        transaction: tx({ offerDiscountType: 'FREE_TRIAL' }),
        owner: owner(),
        current: { id: 'sub-1', appleOriginalTransactionId: ID },
      });
      await expect(service.attach(ORG, 'a.b.c', NO_TRIAL)).resolves.toMatchObject({ isTrailing: true });
      expect(written(subscriptions).isTrailing).toBe(true);
    });
  });

  describe('notify (App Store Server Notifications)', () => {
    const run = async (n: any, opts: any = {}) => {
      const built = build({ notification: n, owner: owner(), ...opts });
      const result = await built.service.notify('a.b.c');
      return { ...built, result };
    };

    it('refuses what Apple did not sign', async () => {
      const { service } = build({ invalid: true });
      await expect(service.notify('a.b.c')).rejects.toMatchObject({ status: 400 });
    });

    it('TEST and anything without a purchase: 200, nothing written', async () => {
      const { result, subscriptions, store } = await run({
        notificationType: 'TEST',
        notificationUUID: 'uuid-1',
      });
      expect(result).toEqual({ ok: true });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      expect(store.markDone).not.toHaveBeenCalled();
    });

    it('SUBSCRIBED:INITIAL_BUY with the free week: a trial on the chosen plan', async () => {
      const { subscriptions, store } = await run(
        notification('SUBSCRIBED', 'INITIAL_BUY', {
          transaction: tx({ offerDiscountType: 'FREE_TRIAL', productId: 'uk.co.postra.app.starter.monthly' }),
        })
      );
      expect(written(subscriptions)).toMatchObject({ tier: 'STANDARD', isTrailing: true, channels: 4, org: ORG });
      expect(store.markDone).toHaveBeenCalledWith('uuid-1', 'SUBSCRIBED:INITIAL_BUY');
    });

    it('SUBSCRIBED:RESUBSCRIBE brings an ended plan back', async () => {
      const { subscriptions } = await run(notification('SUBSCRIBED', 'RESUBSCRIBE'), {
        owner: owner({ deletedAt: new Date() }),
      });
      expect(written(subscriptions)).toMatchObject({ tier: 'PRO', isTrailing: false });
    });

    it('DID_RENEW after the free week: the trial is over, the plan is paid', async () => {
      const { subscriptions } = await run(notification('DID_RENEW'));
      expect(written(subscriptions)).toMatchObject({ tier: 'PRO', isTrailing: false, cancelAt: null });
    });

    it('DID_RENEW:BILLING_RECOVERY restores a plan that lapsed on a failed payment', async () => {
      const { subscriptions } = await run(notification('DID_RENEW', 'BILLING_RECOVERY'), {
        owner: owner({ deletedAt: new Date() }),
      });
      expect(written(subscriptions)).toMatchObject({ tier: 'PRO' });
    });

    it('DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED sets the end of the plan', async () => {
      const transaction = tx();
      const { subscriptions } = await run(
        notification('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_DISABLED', {
          transaction,
          renewal: { autoRenewStatus: 0 },
        })
      );
      expect(written(subscriptions).cancelAt).toBe(Math.floor(transaction.expiresDate / 1000));
    });

    it('DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_ENABLED clears it', async () => {
      const { subscriptions } = await run(
        notification('DID_CHANGE_RENEWAL_STATUS', 'AUTO_RENEW_ENABLED')
      );
      expect(written(subscriptions).cancelAt).toBeNull();
    });

    it('DID_CHANGE_RENEWAL_PREF:UPGRADE moves to the higher plan at once', async () => {
      const { subscriptions } = await run(
        notification('DID_CHANGE_RENEWAL_PREF', 'UPGRADE', {
          transaction: tx({ productId: 'uk.co.postra.app.business.monthly' }),
        })
      );
      expect(written(subscriptions)).toMatchObject({ tier: 'ULTIMATE', channels: 50 });
    });

    it('DID_CHANGE_RENEWAL_PREF:DOWNGRADE keeps the paid plan until the period ends', async () => {
      const { subscriptions } = await run(
        notification('DID_CHANGE_RENEWAL_PREF', 'DOWNGRADE', {
          renewal: { autoRenewStatus: 1, autoRenewProductId: 'uk.co.postra.app.starter.monthly' },
        })
      );
      expect(written(subscriptions)).toMatchObject({ tier: 'PRO', cancelAt: null });
    });

    it('DID_FAIL_TO_RENEW:GRACE_PERIOD keeps the plan while Apple retries', async () => {
      const { subscriptions } = await run(
        notification('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', {
          transaction: tx({ expiresDate: Date.now() - DAY }),
          renewal: { autoRenewStatus: 1, gracePeriodExpiresDate: Date.now() + 2 * DAY },
        })
      );
      expect(written(subscriptions)).toMatchObject({ tier: 'PRO' });
      expect(subscriptions.endAppleSubscription).not.toHaveBeenCalled();
    });

    it.each([
      ['DID_FAIL_TO_RENEW', undefined, { expiresDate: Date.now() - DAY }],
      ['GRACE_PERIOD_EXPIRED', undefined, { expiresDate: Date.now() - 4 * DAY }],
      ['EXPIRED', 'VOLUNTARY', { expiresDate: Date.now() - 1000 }],
      ['EXPIRED', 'BILLING_RETRY', { expiresDate: Date.now() - 1000 }],
      ['REFUND', undefined, { revocationDate: Date.now() - 1000 }],
      ['REVOKE', undefined, { revocationDate: Date.now() - 1000 }],
    ])('%s%s ends the plan and writes no new one', async (type, subtype, over) => {
      const { subscriptions, store } = await run(
        notification(type as string, subtype as any, { transaction: tx(over as any) })
      );
      expect(subscriptions.endAppleSubscription).toHaveBeenCalledWith(ORG, ID, expect.any(Date));
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      expect(store.markDone).toHaveBeenCalled();
    });

    it('an ended purchase is remembered as ended, with the time Apple signed it', async () => {
      const signedDate = Date.now() - 1000;
      const { store } = await run(
        notification('REFUND', undefined, { signedDate, transaction: tx({ revocationDate: signedDate }) })
      );
      expect(store.markEnded).toHaveBeenCalledWith(ID, new Date(signedDate));
    });

    // A refund can outrun the app handing the purchase over.
    it('and so is one that nobody has handed over yet', async () => {
      const built = build({
        notification: notification('REFUND', undefined, { transaction: tx({ revocationDate: Date.now() - 1 }) }),
      });
      await expect(built.service.notify('a.b.c')).resolves.toEqual({ ok: true, unknown: true });
      expect(built.store.markEnded).toHaveBeenCalledWith(ID, expect.any(Date));
      expect(built.store.markDone).toHaveBeenCalled();
    });

    it('a purchase in force is not marked ended', async () => {
      const { store } = await run(notification('DID_RENEW'));
      expect(store.markEnded).not.toHaveBeenCalled();
    });

    it('a redelivery is answered 200 and not applied twice', async () => {
      const { result, subscriptions, store } = await run(notification('DID_RENEW'), { done: true });
      expect(result).toEqual({ ok: true, duplicate: true });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      expect(store.lease).not.toHaveBeenCalled();
    });

    it('one delivery handled twice in a row writes once', async () => {
      const built = build({ notification: notification('DID_RENEW'), owner: owner() });
      await built.service.notify('a.b.c');
      await expect(built.service.notify('a.b.c')).resolves.toEqual({ ok: true, duplicate: true });
      expect(built.subscriptions.createOrUpdateSubscription).toHaveBeenCalledTimes(1);
    });

    it('a notification signed before the state already written is not applied over it', async () => {
      const { subscriptions, store } = await run(
        notification('DID_RENEW', undefined, { signedDate: Date.now() - 2 * DAY }),
        { owner: owner({ deletedAt: new Date(), appleSignedAt: new Date(Date.now() - DAY) }) }
      );
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      expect(subscriptions.endAppleSubscription).not.toHaveBeenCalled();
      expect(store.markDone).toHaveBeenCalled();
    });

    it('a purchase not tied to an organisation yet: 200, nothing written', async () => {
      const built = build({ notification: notification('SUBSCRIBED', 'INITIAL_BUY') });
      await expect(built.service.notify('a.b.c')).resolves.toEqual({ ok: true, unknown: true });
      expect(built.subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('a renewal of a purchase whose plan ended and was replaced writes nothing', async () => {
      const { subscriptions } = await run(notification('DID_RENEW'), {
        owner: owner({ deletedAt: new Date() }),
        current: { id: 'sub-2', appleOriginalTransactionId: null },
      });
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
    });

    it('answers 409 while another notification of the purchase is handled', async () => {
      const built = build({ notification: notification('DID_RENEW'), owner: owner() });
      built.store.lease.mockResolvedValue(false);
      await expect(built.service.notify('a.b.c')).rejects.toMatchObject({ status: 409 });
    });

    it('a failed write answers 500 and is not marked done, so Apple delivers again', async () => {
      const built = build({ notification: notification('DID_RENEW'), owner: owner() });
      built.subscriptions.createOrUpdateSubscription.mockRejectedValue(new Error('db down'));
      await expect(built.service.notify('a.b.c')).rejects.toMatchObject({ status: 500 });
      expect(built.store.markDone).not.toHaveBeenCalled();
      expect(built.store.release).toHaveBeenCalledWith(ID, 'uuid-1');
    });
    // Security review: a refund of an earlier renewal does not take
    // back the period being paid for now.
    it('REFUND of an earlier, finished period leaves the plan and the purchase alone', async () => {
      const { subscriptions, store } = await run(
        notification('REFUND', undefined, {
          transaction: tx({
            purchaseDate: Date.now() - 40 * DAY,
            expiresDate: Date.now() - 10 * DAY,
            revocationDate: Date.now() - 1000,
          }),
        })
      );
      expect(subscriptions.endAppleSubscription).not.toHaveBeenCalled();
      expect(subscriptions.createOrUpdateSubscription).not.toHaveBeenCalled();
      expect(store.markEnded).not.toHaveBeenCalled();
      expect(store.markDone).toHaveBeenCalled();
    });

    it('a renewal records the end of the new period, or of the grace period when later', async () => {
      const expiresDate = Date.now() - DAY;
      const grace = Date.now() + 2 * DAY;
      const { subscriptions } = await run(
        notification('DID_FAIL_TO_RENEW', 'GRACE_PERIOD', {
          transaction: tx({ expiresDate }),
          renewal: { autoRenewStatus: 1, gracePeriodExpiresDate: grace },
        })
      );
      expect(written(subscriptions).apple.expiresAt).toEqual(new Date(grace));
    });
  });

  // Security review: a plan must end even when Apple's
  // expiry notification never arrives.
  describe('expireLapsed (daily housekeeping)', () => {
    const lapsed = (over: any = {}) => ({
      id: 'sub-1',
      organizationId: ORG,
      appleOriginalTransactionId: ID,
      appleExpiresAt: new Date(Date.now() - 2 * DAY),
      appleSignedAt: new Date(Date.now() - 32 * DAY),
      ...over,
    });

    it('ends a plan a day past its period, keeping the date Apple last signed', async () => {
      const row = lapsed();
      const built = build({ current: row });
      built.repository.listLapsedApple.mockResolvedValue([row]);
      const now = new Date();
      await expect(built.service.expireLapsed(now)).resolves.toEqual([ORG]);
      expect(built.repository.listLapsedApple).toHaveBeenCalledWith(
        new Date(now.getTime() - DAY)
      );
      // The same date: a renewal Apple signed later still applies over it.
      expect(built.subscriptions.endAppleSubscription).toHaveBeenCalledWith(ORG, ID, row.appleSignedAt);
      expect(built.store.markEnded).not.toHaveBeenCalled();
      expect(built.store.release).toHaveBeenCalledWith(ID, expect.any(String));
    });

    it('leaves a plan renewed since the list was read', async () => {
      const built = build({ current: lapsed({ appleExpiresAt: new Date(Date.now() + 29 * DAY) }) });
      built.repository.listLapsedApple.mockResolvedValue([lapsed()]);
      await expect(built.service.expireLapsed()).resolves.toEqual([]);
      expect(built.subscriptions.endAppleSubscription).not.toHaveBeenCalled();
    });

    it('leaves it for tomorrow while a notification of the purchase is handled', async () => {
      const built = build({ current: lapsed() });
      built.repository.listLapsedApple.mockResolvedValue([lapsed()]);
      built.store.lease.mockResolvedValue(false);
      await expect(built.service.expireLapsed()).resolves.toEqual([]);
      expect(built.subscriptions.endAppleSubscription).not.toHaveBeenCalled();
    });

    it('one failure does not stop the others', async () => {
      const other = lapsed({ organizationId: 'org-2', appleOriginalTransactionId: 'X2' });
      const built = build();
      built.repository.listLapsedApple.mockResolvedValue([lapsed(), other]);
      built.repository.getSubscriptionByOrgId.mockImplementation(async (org: string) =>
        org === ORG ? lapsed() : other
      );
      built.subscriptions.endAppleSubscription
        .mockRejectedValueOnce(new Error('db down'))
        .mockResolvedValueOnce({ revoked: true });
      await expect(built.service.expireLapsed()).resolves.toEqual(['org-2']);
      expect(built.store.release).toHaveBeenCalledTimes(2);
    });

    it('does nothing while the feature is off', async () => {
      delete process.env.APPLE_IAP_ENABLED;
      const built = build();
      await expect(built.service.expireLapsed()).resolves.toEqual([]);
      expect(built.repository.listLapsedApple).not.toHaveBeenCalled();
    });
  });
});
