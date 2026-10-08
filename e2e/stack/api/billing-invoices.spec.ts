import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Billing history (upstream 3bd88cee9 + 8f3c38ab1): the organisation's
// invoices from Stripe. Without a Stripe customer there is nothing to list —
// an empty list, not an error.
const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('an organisation without a Stripe customer has an empty billing history', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const res = await org.api.get('/billing/invoices');
    expect(res.status(), await res.text()).toBe(200);
    expect(await res.json()).toEqual([]);
  } finally {
    await org.remove();
  }
});
