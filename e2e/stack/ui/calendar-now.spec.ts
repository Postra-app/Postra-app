import { expect, test } from '@playwright/test';
import { stateFile } from '../helpers';
import { weekOf } from './ui-helpers';

// Upstream 47175b5a: one shared clock for the calendar, a "now" line in the
// week view, and the hours that pass while the calendar is open get blocked.
// Organisation B: nothing is created, A's calendar stays as the other UI
// tests expect it. The browser runs in Europe/London (BST in October).

// 10:30 in London.
const START = new Date('2026-10-14T09:30:00Z');

test('an hour that passes while the calendar is open gets blocked', async ({ page }) => {
  // Each cell had its own timer and `setNum(num + 1)` read a stale `num`, so
  // a cell turned into the past at most once, two minutes after it rendered.
  await page.clock.install({ time: START });
  await page.goto(weekOf(START));
  const eleven = page.locator('[data-slot="2026-10-14T11:00"]');
  await expect(eleven).toBeVisible();
  await expect(eleven).not.toHaveClass(/repeated-strip/);

  await page.clock.runFor(60 * 60 * 1000);
  await expect(eleven).toHaveClass(/repeated-strip/);
});

test('the week shows the current time, and it moves on', async ({ page }) => {
  await page.clock.install({ time: START });
  await page.goto(weekOf(START));
  await expect(page.getByText('10:30', { exact: true })).toBeVisible();

  await page.clock.runFor(60 * 60 * 1000);
  await expect(page.getByText('11:30', { exact: true })).toBeVisible();
});
