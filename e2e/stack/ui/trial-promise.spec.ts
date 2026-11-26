import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The plan screen of an account without a plan. With the trial on offer it
// shows the trial's limits and one button, and no card form; after a trial
// without a card has ended it says so; otherwise it is the checkout.
test.use({ storageState: { cookies: [], origins: [] } });

const scenarios = [
  { name: 'trial on offer', allowTrial: true, trialEnded: false },
  { name: 'trial ended', allowTrial: false, trialEnded: true },
  { name: 'no trial', allowTrial: false, trialEnded: false },
];

for (const s of scenarios) {
  test(`the plan screen: ${s.name}`, async ({ page, context }) => {
    const prisma = database();
    const free = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
    await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
    await prisma.organization.update({ where: { id: free.orgId }, data: { allowTrial: s.allowTrial } });
    try {
      await context.addCookies((await free.api.storageState()).cookies);
      await context.route(/js\.stripe\.com/, (route) => route.abort());
      await page.route('**/api/user/self', async (route) => {
        const res = await route.fetch();
        await route.fulfill({ response: res, json: { ...(await res.json()), allowTrial: s.allowTrial } });
      });
      const checkouts: string[] = [];
      await page.route('**/api/billing/embedded', (route) => {
        checkouts.push(route.request().url());
        return route.fulfill({ json: { client_secret: 'cs_test_secret_x', trial: false, trialEnded: s.trialEnded } });
      });
      let started = '';
      await page.route('**/api/billing/start-trial', (route) => {
        started = route.request().postData() || '';
        return route.fulfill({ status: 201, json: { id: 'trial-x' } });
      });
      await page.goto('/billing');

      if (s.allowTrial) {
        const limits = page.getByTestId('trial-limits').filter({ visible: true }).first();
        await expect(limits).toContainText('Your 5-day free trial includes:', { timeout: 20_000 });
        await expect(limits).toContainText('2 channels');
        await expect(page.getByText('No card needed to start').filter({ visible: true })).toHaveCount(1);
        expect(checkouts).toEqual([]);
        await page.getByRole('button', { name: 'Start 5-day free trial' }).click();
        await page.waitForURL(/\/launches\?onboarding=true&check=trial-x/, { timeout: 20_000 });
        expect(JSON.parse(started)).toMatchObject({ billing: 'STANDARD', period: 'MONTHLY' });
      } else if (s.trialEnded) {
        await expect(page.getByRole('heading', { name: 'Your free trial has ended' }).first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('Your channels, posts and media are saved.').first()).toBeVisible();
        await expect(page.getByTestId('trial-limits')).toHaveCount(0);
      } else {
        await expect(page.getByText('Create a month of content').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText('The payment form could not be loaded').first()).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('trial-limits')).toHaveCount(0);
        await expect(page.getByRole('heading', { name: 'Your free trial has ended' })).toHaveCount(0);
      }
    } finally {
      await free.remove();
      await prisma.$disconnect();
    }
  });
}
