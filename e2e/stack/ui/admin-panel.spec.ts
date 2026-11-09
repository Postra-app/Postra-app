import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';
import { totpCode, totpStep } from '../../../libraries/helpers/src/auth/totp';

// axe (WCAG 2.2 A/AA) on every tab of the admin panel, as a Postra
// administrator sees it after the second step. a11y.spec.ts covers the
// screens a customer lives in; the panel had only a wiring test of its
// sidebar (admin-a11y.wiring.spec.ts) and was never run through axe.

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const TABS = [
  '/admin/stats',
  '/admin/growth',
  '/admin/organizations',
  '/admin/subscriptions',
  '/admin/ai-usage',
  '/admin/health',
  '/admin/errors',
  '/admin/users',
  '/admin/announcements',
  '/admin/audit',
  '/admin/channels',
  '/admin/dashboards',
];

test.use({ storageState: { cookies: [], origins: [] } });

// A Postra administrator in this browser, past the second step
// (ADMIN_TOTP_REQUIRED on the stack).
const signInAsAdmin = async (page: Page, prisma: ReturnType<typeof database>) => {
  const staff = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  await prisma.user.update({ where: { id: staff.userId }, data: { isSuperAdmin: true } });
  const api = page.context().request;
  const login = await api.post(`${BACKEND_URL}/auth/login`, {
    data: { email: staff.email, password: staff.password, provider: 'LOCAL' },
    headers: { 'x-forwarded-for': `198.21.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
  });
  expect(login.status(), await login.text()).toBe(200);
  let setup: Awaited<ReturnType<typeof api.post>> | undefined;
  await expect
    .poll(async () => (setup = await api.post(`${BACKEND_URL}/two-factor/setup`)).status(), { timeout: 60_000 })
    .toBe(201);
  const { secret } = await setup!.json();
  const enabled = await api.post(`${BACKEND_URL}/two-factor/enable`, {
    data: { code: totpCode(secret, totpStep()) },
  });
  expect(enabled.status(), await enabled.text()).toBe(201);
  return staff;
};

test('every admin tab passes axe', async ({ page }) => {
  test.setTimeout(240_000);
  const prisma = database();
  const staff = await signInAsAdmin(page, prisma);
  try {
    const found: Record<string, string[]> = {};
    for (const tab of TABS) {
      await page.goto(tab);
      await expect(page).toHaveURL(new RegExp(`${tab}$`));
      await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();
      await page.waitForLoadState('networkidle');
      await page.evaluate(AXE);
      const violations: string[] = await page.evaluate(async () => {
        const result = await (window as any).axe.run(document, {
          runOnly: {
            type: 'tag',
            values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
          },
        });
        return result.violations
          .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
          .map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
      });
      if (violations.length) found[tab] = violations;
    }
    expect(found).toEqual({});
  } finally {
    await staff.remove();
  }
});

// The panel said "ULTIMATE" where the landing page and Billing say "Business",
// and Growth showed today to today with "30d" lit.
test('the panel names plans like the rest of Postra and shows the range it charts', async ({ page }) => {
  test.setTimeout(180_000);
  const prisma = database();
  const staff = await signInAsAdmin(page, prisma);
  const business = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 15, channels: 0 });
  try {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: business.orgId } });
    await page.goto('/admin/organizations');
    await page.getByRole('textbox', { name: 'Search organizations' }).fill(org.name);
    const row = page.getByRole('row').filter({ hasText: org.name });
    await expect(row).toContainText('Business');
    await expect(row).not.toContainText('ULTIMATE');

    const iso = (days: number) => {
      const d = new Date();
      d.setDate(d.getDate() - days);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    await page.goto('/admin/growth');
    await expect(page.getByLabel('From', { exact: true })).toHaveValue(iso(30));
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(iso(0));
    await page.getByRole('button', { name: '7d', exact: true }).click();
    await expect(page.getByLabel('From', { exact: true })).toHaveValue(iso(7));
  } finally {
    await business.remove();
    await staff.remove();
  }
});
