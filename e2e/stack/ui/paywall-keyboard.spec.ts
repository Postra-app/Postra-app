import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// The paywall's plans and Monthly/Yearly were plain divs: from the keyboard
// only the preselected plan (Starter, monthly) could be bought.
test.use({ storageState: { cookies: [], origins: [] } });

test('plans and the billing period can be chosen from the keyboard', async ({ page, context }) => {
  const prisma = database();
  const free = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    await prisma.subscription.deleteMany({ where: { organizationId: free.orgId } });
    await context.addCookies((await free.api.storageState()).cookies);
    await page.goto('/billing');
    const yearly = page.getByRole('button', { name: /Yearly/ });
    await expect(yearly).toBeVisible({ timeout: 30_000 });
    await yearly.focus();
    await page.keyboard.press('Enter');
    await expect(yearly).toHaveAttribute('aria-pressed', 'true');
    const pro = page.getByRole('button', { name: /^Pro\b/ });
    await pro.focus();
    await page.keyboard.press('Enter');
    await expect(pro).toHaveAttribute('aria-pressed', 'true');
    await expect(pro).toContainText('/ year');
  } finally {
    await free.remove();
    await prisma.$disconnect();
  }
});
