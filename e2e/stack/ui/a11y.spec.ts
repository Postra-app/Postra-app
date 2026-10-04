import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';

// axe (WCAG 2.2 A/AA) on the ten screens a customer lives in (P8). Critical
// and serious violations fail the test. Measured on production 2026-10-04
// before the fix: every page without <html lang>, 62–200 images without alt
// in the calendar, an invalid role on every channel row, unnamed selects,
// scroll areas the keyboard could not reach.
//
// Two third-party widgets are left out until their own fixes: Uppy's
// dashboard (aria-label on a div with no role) and CopilotKit's send button
// (an icon with no name).

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const SCREENS = [
  '/launches',
  '/launches?display=day',
  '/launches?display=month',
  '/launches?display=list',
  '/settings',
  '/media',
  '/analytics',
  '/agents',
  '/plugs',
  '/help',
];

const violations = async (page: Page) => {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    const result = await (window as any).axe.run(
      { exclude: [['.uppy-Dashboard'], ['.copilotKitInputControlButton']] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      }
    );
    return result.violations
      .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
      .map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
  });
};

for (const screen of SCREENS) {
  test(`axe: ${screen}`, async ({ page }) => {
    await page.goto(screen);
    await page.waitForLoadState('networkidle');
    expect(await violations(page)).toEqual([]);
  });
}

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('axe: /auth/login', async ({ page }) => {
    await page.goto('/auth/login');
    await page.waitForLoadState('networkidle');
    expect(await violations(page)).toEqual([]);
  });
});
