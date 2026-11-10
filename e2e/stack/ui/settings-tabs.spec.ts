import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

// Every Settings tab, not only the one /settings opens on: axe and phone
// width measured Global Settings and nothing behind the other seven tabs.

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const TABS = [
  'Global Settings',
  'Teams',
  'Webhooks',
  'Auto Post',
  'Sets',
  'Signatures',
  'Developers',
  'Approved apps',
];

const violations = async (page: Page) => {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(
      { exclude: [['.uppy-Dashboard'], ['.copilotKitInputControlButton']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }
    );
    return result.violations
      .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
      .map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
  });
};

const openTab = async (page: Page, name: string) => {
  await page.goto('/settings');
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('tab', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.waitForLoadState('networkidle');
};

for (const name of TABS) {
  test(`axe: Settings → ${name}`, async ({ page }) => {
    await openTab(page, name);
    expect(await violations(page)).toEqual([]);
  });
}

test.describe('at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  for (const name of TABS) {
    test(`Settings → ${name} does not scroll sideways`, async ({ page }) => {
      await openTab(page, name);
      expect(await page.evaluate(() => window.innerWidth)).toBe(390);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    });
  }
});

// Texts that stayed English in the Polish app: the time format, the MCP setup
// hints, the button that saves a set, and "Wyloguj się z Postra".
test.describe('in Polish', () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies([{ name: 'i18next', value: 'pl', url: baseURL! }]);
  });

  test('Global Settings: the time format and logout are Polish', async ({ page }) => {
    await page.goto('/settings');
    const format = page.getByRole('combobox', { name: 'Format godziny' });
    await expect(format.locator('option')).toHaveText(['12-godzinny (AM/PM)', '24-godzinny']);
    await expect(page.getByText('Wyloguj się z Postry', { exact: true })).toBeVisible();
    await expect(page.getByText('w zakładce Zespoły', { exact: false })).toBeVisible();
  });

  test('Developers: the MCP setup hint is Polish', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Deweloperzy', exact: true }).click();
    await expect(page.getByText('Uruchom to polecenie w terminalu.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cursor', exact: true }).click();
    await expect(
      page.getByText('Dodaj do pliku .cursor/mcp.json w katalogu głównym projektu.', { exact: true })
    ).toBeVisible();
    await expect(page.getByText('Run this command in your terminal.')).toHaveCount(0);
  });

  test('Sets: the set editor saves with a Polish button', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Zestawy', exact: true }).click();
    await page.getByRole('button', { name: 'Dodaj zestaw', exact: true }).click();
    const editor = page.getByRole('dialog');
    await expect(editor.getByRole('button', { name: 'Zapisz zestaw', exact: true })).toBeVisible();
    await expect(editor.getByText('Save Set', { exact: true })).toHaveCount(0);
  });
});
