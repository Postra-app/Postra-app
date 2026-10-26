import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// 18 X: a second account paid with a card that already had a trial. Nothing
// was charged and the trial was cancelled, but the page said "Invalid payment -
// we could not verify your payment method" and kept offering the trial.
test.use({ storageState: { cookies: [], origins: [] } });

test('a card that already had a trial is named after the checkout, and the plan comes back without one', async ({
  page,
  context,
}) => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
  await prisma.organization.update({ where: { id: free.orgId }, data: { allowTrial: true } });
  try {
    await context.addCookies((await free.api.storageState()).cookies);
    await context.route(/js\.stripe\.com/, (route) => route.abort());
    let rejected = false;
    await page.route('**/api/user/self', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), allowTrial: !rejected } });
    });
    const checkouts: boolean[] = [];
    await page.route('**/api/billing/embedded', (route) => {
      checkouts.push(!rejected);
      return route.fulfill({ json: { client_secret: 'cs_test_secret_x', trial: !rejected } });
    });
    await page.route('**/api/billing/check/**', (route) => {
      rejected = true;
      return route.fulfill({ json: { status: 3 } });
    });

    await page.goto('/launches?onboarding=true&check=uniq-x');

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Free trial already used')).toBeVisible({ timeout: 20_000 });
    await expect(
      dialog.getByText('This card has already been used for a Postra trial. Choose a plan to subscribe without a trial.')
    ).toBeVisible();
    await expect(page.getByText('Invalid payment')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'OK' }).click();

    // The checkout was loaded again, this time without the trial, and the
    // page no longer promises one.
    await expect.poll(() => checkouts.includes(false), { timeout: 20_000 }).toBe(true);
    await expect(page.getByText('Pay nothing for the first 7 days')).toHaveCount(0);
    // Answered once: a reload does not run the check and its message again.
    expect(new URL(page.url()).searchParams.has('check')).toBe(false);
  } finally {
    await free.remove();
    await prisma.$disconnect();
  }
});
