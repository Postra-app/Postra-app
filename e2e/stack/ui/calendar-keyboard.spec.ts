import { expect, test } from '@playwright/test';
import { createDraft, signedIn, stateFile } from '../helpers';
import { weekOf } from './ui-helpers';

// A post in the calendar opens from the keyboard, and its actions (duplicate,
// preview, delete…) appear on focus, not only on mouse hover. Both were divs
// that Tab never reached. Organisation B: a draft in A's calendar would sit
// under the other UI tests' clicks.
test.use({ storageState: stateFile('b') });

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

test('Tab reaches a post, its actions show, Enter opens it', async ({
  page,
}) => {
  const api = await signedIn('b');
  const text = `Keyboard post ${Date.now()}`;
  const post = await createDraft(api, 'b', text);
  try {
    // createDraft dates the post two days ahead; show that week.
    const day = new Date(Date.now() + 2 * 86_400_000);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    await page.goto(
      `/launches?display=week&startDate=${isoDay(monday)}&endDate=${isoDay(
        sunday
      )}`
    );

    const tile = page.locator('[role=button]', { hasText: text });
    await tile.focus();
    await expect(
      page.getByRole('button', { name: 'Preview Post' }).first()
    ).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page.locator('.ProseMirror').first()).toContainText(text);
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});

// Upstream adf1a8f5: the actions end with Preview, Duplicate, Delete, so
// Delete is the last one and not between Duplicate and the statistics.
test('the post actions end with Preview, Duplicate and Delete', async ({ page }) => {
  const api = await signedIn('b');
  const text = `Action order ${Date.now()}`;
  const post = await createDraft(api, 'b', text);
  try {
    const day = new Date(Date.now() + 2 * 86_400_000);
    const monday = new Date(day);
    monday.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    await page.goto(`/launches?display=week&startDate=${isoDay(monday)}&endDate=${isoDay(sunday)}`);
    await page.locator('[role=button]', { hasText: text }).focus();
    const actions = page.getByRole('button', { name: /^(Preview|Duplicate|Delete) Post$/ });
    await expect(actions.first()).toBeVisible();
    expect(await actions.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual([
      'Preview Post',
      'Duplicate Post',
      'Delete Post',
    ]);
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});

// The channel panel's collapse toggle and the AI post Creator were divs with
// click handlers: no name, and Tab never reached them.
test('the channel panel collapses and the Creator opens from the keyboard', async ({
  page,
}) => {
  await page.goto('/launches');
  const collapse = page.getByRole('button', { name: 'Collapse channels' });
  await collapse.focus();
  await page.keyboard.press('Enter');
  const expand = page.getByRole('button', { name: 'Expand channels' });
  await expect(expand).toHaveAttribute('aria-expanded', 'false');
  await expand.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Collapse channels' })
  ).toHaveAttribute('aria-expanded', 'true');

  await page.getByRole('button', { name: 'Generate Posts' }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('dialog', { name: 'Generate Posts' })
  ).toBeVisible();
});

test('the period arrows, Today and the view switch work from the keyboard', async ({
  page,
}) => {
  // They were divs: no name, never reached by Tab.
  await page.goto(weekOf(new Date()));
  const range = async () => new URL(page.url()).searchParams.get('startDate');
  const before = await range();
  await page.getByRole('button', { name: 'Next week' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(range).not.toBe(before);
  await page.getByRole('button', { name: 'Today', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(range).toBe(before);
  await page.getByRole('button', { name: 'Month', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Month', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeVisible();
  await page.getByRole('button', { name: 'List view' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
});
