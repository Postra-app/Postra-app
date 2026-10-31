import { expect, test } from '@playwright/test';
import Stripe from 'stripe';
import { database, throwawayOrg } from '../helpers';

// Two first checkouts of one organisation at once (two tabs, a double click)
// each made a Stripe customer, and the organisation kept only one: a payment
// through the other checkout was taken and no plan followed. Both checkouts
// now run on the one stored customer. Stripe TEST mode, `pnpm e2e:stack:billing`.

const sk = process.env.STRIPE_SECRET_KEY || '';
test.skip(!sk.startsWith('sk_test_'), 'needs Stripe test-mode keys');
const stripe = new Stripe(sk);

test('two first checkouts at once open on the one customer the organisation keeps', async () => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  const email = (await prisma.user.findFirstOrThrow({ where: { organizations: { some: { organizationId: free.orgId } } } })).email;
  let stored: string | null = null;
  try {
    const opened = await Promise.all(
      [1, 2].map(() => free.api.post('/billing/embedded', { data: { billing: 'STANDARD', period: 'MONTHLY' } }))
    );
    const secrets: string[] = [];
    for (const res of opened) {
      expect(res.status(), await res.text()).toBeLessThan(300);
      secrets.push((await res.json()).client_secret);
    }

    stored = (await prisma.organization.findUniqueOrThrow({ where: { id: free.orgId } })).paymentId;
    expect(stored).toMatch(/^cus_/);
    const customers = await Promise.all(
      secrets.map(async (secret) => (await stripe.checkout.sessions.retrieve(secret.split('_secret_')[0])).customer)
    );
    expect(customers).toEqual([stored, stored]);

    // The customer the losing request made is gone from Stripe.
    await expect
      .poll(async () => (await stripe.customers.list({ email, limit: 10 })).data.map((c) => c.id), { timeout: 30_000 })
      .toEqual([stored]);
  } finally {
    for (const c of (await stripe.customers.list({ email, limit: 10 })).data) {
      await stripe.customers.del(c.id).catch(() => undefined);
    }
    await free.remove();
    await prisma.$disconnect();
  }
});
