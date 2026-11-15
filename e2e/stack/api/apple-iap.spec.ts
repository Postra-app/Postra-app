import { expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { anonymous, database, throwawayOrg } from '../helpers';

// A plan bought in the iOS app is billed by Apple: the app hands over the
// transaction, Apple's notifications keep it in step, and Stripe stays out of
// it. The whole path over HTTP and the real database, with purchases of the
// unsigned kind StoreKit testing in Xcode produces (stack.env).
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 86_400_000;
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jws = (payload: Record<string, unknown>) =>
  `${b64({ alg: 'ES256', x5c: [] })}.${b64(payload)}.${Buffer.from('stack').toString('base64url')}`;

let purchases = 0;
const purchase = () => `stack-${process.pid}-${Date.now()}-${++purchases}`;
const transaction = (id: string, over: Record<string, unknown> = {}) =>
  jws({
    originalTransactionId: id,
    transactionId: `${id}-1`,
    bundleId: 'uk.co.postra.app',
    productId: 'uk.co.postra.app.pro.monthly',
    purchaseDate: Date.now() - 1000,
    expiresDate: Date.now() + 7 * DAY,
    signedDate: Date.now(),
    environment: 'Xcode',
    ...over,
  });
const notification = (
  type: string,
  id: string,
  over: { subtype?: string; signedDate?: number; tx?: Record<string, unknown>; renewal?: Record<string, unknown> } = {}
) => ({
  signedPayload: jws({
    notificationType: type,
    subtype: over.subtype,
    notificationUUID: `${id}-${type}-${over.subtype ?? ''}-${over.signedDate ?? Date.now()}`,
    signedDate: over.signedDate ?? Date.now(),
    version: '2.0',
    data: {
      bundleId: 'uk.co.postra.app',
      environment: 'Xcode',
      signedTransactionInfo: transaction(id, { signedDate: over.signedDate ?? Date.now(), ...over.tx }),
      signedRenewalInfo: jws({
        originalTransactionId: id,
        autoRenewStatus: 1,
        environment: 'Xcode',
        signedDate: over.signedDate ?? Date.now(),
        ...over.renewal,
      }),
    },
  }),
});

// An organisation with no plan, as one that signed up and never chose one.
const withoutPlan = async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 4, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: org.orgId } });
  // The request's organisation is cached per user; sign-in happened with the plan.
  const self = async () => (await (await org.api.get('/user/self')).json()) as Record<string, unknown>;
  return { ...org, self };
};

test('the plans the app may sell are listed, signed in only', async () => {
  const org = await withoutPlan();
  const anon = await anonymous();
  try {
    const res = await org.api.get('/billing/apple/plans');
    expect(res.status()).toBe(200);
    expect((await res.json()).plans).toEqual([
      { productId: 'uk.co.postra.app.starter.monthly', tier: 'STANDARD', channels: 4 },
      { productId: 'uk.co.postra.app.pro.monthly', tier: 'PRO', channels: 8 },
      { productId: 'uk.co.postra.app.business.monthly', tier: 'ULTIMATE', channels: 15 },
    ]);
    expect((await anon.get('/billing/apple/plans')).status()).toBe(401);
  } finally {
    await anon.dispose();
    await org.remove();
  }
});

test('a purchase from the app becomes the plan, a trial under the trial limits', async () => {
  const org = await withoutPlan();
  try {
    await expect.poll(async () => (await org.self()).tier).toBe('FREE');

    const id = purchase();
    const res = await org.api.post('/billing/apple/transaction', {
      data: { signedTransaction: transaction(id, { offerDiscountType: 'FREE_TRIAL' }) },
    });
    expect(res.status(), await res.text()).toBe(201);
    expect(await res.json()).toEqual({ ok: true, tier: 'PRO', isTrailing: true });

    const self = await org.self();
    expect(self).toMatchObject({ tier: 'PRO', isTrailing: true, appleBilled: true });
    // The trial cap on channels, as for a trial started on the web.
    expect(self.totalChannels).toBe(3);

    const row = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.orgId } });
    expect(row).toMatchObject({
      subscriptionTier: 'PRO',
      period: 'MONTHLY',
      totalChannels: 8,
      appleOriginalTransactionId: id,
      deletedAt: null,
      isLifetime: false,
      compReason: null,
    });
  } finally {
    await org.remove();
  }
});

test('what is not a purchase of this app is refused and changes nothing', async () => {
  const org = await withoutPlan();
  try {
    for (const signedTransaction of [
      'not-a-jws',
      'a.b.c',
      transaction(purchase(), { bundleId: 'com.someone.else' }),
      transaction(purchase(), { productId: 'uk.co.postra.app.gold.monthly' }),
      transaction(purchase(), { expiresDate: Date.now() - 1000 }),
      transaction(purchase(), { revocationDate: Date.now() - 1000 }),
    ]) {
      const res = await org.api.post('/billing/apple/transaction', { data: { signedTransaction } });
      expect([400, 409], `${res.status()} ${await res.text()}`).toContain(res.status());
    }
    expect(await prisma.subscription.count({ where: { organizationId: org.orgId } })).toBe(0);
    expect((await org.self()).tier).toBe('FREE');
  } finally {
    await org.remove();
  }
});

test('one purchase pays for one organisation, and an organisation is billed by Apple or by Stripe', async () => {
  const first = await withoutPlan();
  const second = await withoutPlan();
  const onStripe = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 4, channels: 0 });
  try {
    const id = purchase();
    const signedTransaction = transaction(id);
    expect((await first.api.post('/billing/apple/transaction', { data: { signedTransaction } })).status()).toBe(201);

    // The same purchase for another organisation.
    const stolen = await second.api.post('/billing/apple/transaction', { data: { signedTransaction } });
    expect(stolen.status()).toBe(409);
    expect((await second.self()).tier).toBe('FREE');

    // An organisation that already has a plan does not get a second one.
    const doubled = await onStripe.api.post('/billing/apple/transaction', {
      data: { signedTransaction: transaction(purchase()) },
    });
    expect(doubled.status()).toBe(409);
    const kept = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: onStripe.orgId } });
    expect(kept).toMatchObject({ subscriptionTier: 'STANDARD', appleOriginalTransactionId: null });

    // And the organisation Apple bills cannot open a Stripe checkout.
    for (const route of ['/billing/subscribe', '/billing/embedded']) {
      const res = await first.api.post(route, { data: { period: 'MONTHLY', billing: 'ULTIMATE' } });
      expect(res.status(), `${route}: ${await res.text()}`).toBe(409);
    }
  } finally {
    await first.remove();
    await second.remove();
    await onStripe.remove();
  }
});

test('Apple’s notifications keep the plan in step: paid, cancelled, upgraded, refunded', async () => {
  const org = await withoutPlan();
  const apple = await anonymous();
  const notify = async (body: unknown) => {
    const res = await apple.post('/apple/notifications', { data: body });
    return { status: res.status(), body: await res.json().catch(() => ({})) };
  };
  try {
    const id = purchase();
    expect(
      (
        await org.api.post('/billing/apple/transaction', {
          data: { signedTransaction: transaction(id, { offerDiscountType: 'FREE_TRIAL' }) },
        })
      ).status()
    ).toBe(201);

    // The free week ends and Apple charges: no longer a trial.
    const renewed = notification('DID_RENEW', id, { tx: { expiresDate: Date.now() + 30 * DAY } });
    expect(await notify(renewed)).toEqual({ status: 200, body: { ok: true } });
    expect(await org.self()).toMatchObject({ tier: 'PRO', isTrailing: false, appleBilled: true, totalChannels: 8 });

    // The same delivery again is not applied twice.
    expect(await notify(renewed)).toEqual({ status: 200, body: { ok: true, duplicate: true } });

    // Auto-renew off: the plan ends with the paid period.
    const ends = Date.now() + 30 * DAY;
    await notify(
      notification('DID_CHANGE_RENEWAL_STATUS', id, {
        subtype: 'AUTO_RENEW_DISABLED',
        tx: { expiresDate: ends },
        renewal: { autoRenewStatus: 0 },
      })
    );
    let row = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.orgId } });
    expect(row.cancelAt?.getTime()).toBe(Math.floor(ends / 1000) * 1000);

    // Back on, and up to Business.
    await notify(
      notification('DID_CHANGE_RENEWAL_PREF', id, {
        subtype: 'UPGRADE',
        tx: { productId: 'uk.co.postra.app.business.monthly', expiresDate: ends },
      })
    );
    row = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.orgId } });
    expect(row).toMatchObject({ subscriptionTier: 'ULTIMATE', totalChannels: 15, cancelAt: null });

    // A delivery signed before all that arrives late: ignored.
    expect(
      (await notify(notification('DID_RENEW', id, { signedDate: Date.now() - DAY }))).status
    ).toBe(200);
    expect((await org.self()).tier).toBe('ULTIMATE');

    // A purchase nobody handed over yet: accepted, nothing to write.
    expect(await notify(notification('SUBSCRIBED', purchase(), { subtype: 'INITIAL_BUY' }))).toEqual({
      status: 200,
      body: { ok: true, unknown: true },
    });

    // Refunded: back to no plan, and the row is kept as ended.
    expect(
      (await notify(notification('REFUND', id, { tx: { revocationDate: Date.now() } }))).status
    ).toBe(200);
    expect(await org.self()).toMatchObject({ tier: 'FREE', appleBilled: false });
    row = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.orgId } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.appleOriginalTransactionId).toBe(id);

    // Subscribing again with the same Apple ID brings the plan back.
    await notify(
      notification('SUBSCRIBED', id, { subtype: 'RESUBSCRIBE', tx: { expiresDate: Date.now() + 30 * DAY } })
    );
    expect(await org.self()).toMatchObject({ tier: 'PRO', appleBilled: true });
  } finally {
    await apple.dispose();
    await org.remove();
  }
});

test('the notification address answers 400 to anything Apple did not send', async () => {
  const apple = await anonymous();
  try {
    for (const data of [{}, { signedPayload: 'nope' }, { signedPayload: 'a.b.c' }, { signedPayload: 42 }]) {
      const res = await apple.post('/apple/notifications', { data });
      expect(res.status(), JSON.stringify(data)).toBe(400);
    }
    // A notification for another app.
    const other = jws({
      notificationType: 'DID_RENEW',
      notificationUUID: 'x',
      data: { bundleId: 'com.someone.else', environment: 'Xcode' },
    });
    expect((await apple.post('/apple/notifications', { data: { signedPayload: other } })).status()).toBe(400);
  } finally {
    await apple.dispose();
  }
});
