import { expect, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';
import { openComposer, watchForErrors } from './ui-helpers';

// The customer's main path in a real browser against the local stack:
// calendar → composer → draft, and → "Post Now" all the way to the platform
// (the fake Mastodon). On production only the draft half may ever run.

const FAKE = 'http://localhost:58080';

test('the calendar shows the organisation and its channels', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/launches');
  await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
  await expect(page.getByText(USERS.a.channel.name)).toBeVisible();
  await expect(page.getByText(USERS.a.mastodon.name)).toBeVisible();
  // Organisation B's channel must not leak into A's calendar.
  await expect(page.getByText(USERS.b.channel.name)).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('a draft saved in the composer appears in the calendar', async ({ page }) => {
  const problems = watchForErrors(page);
  const text = `[stack ui] draft ${Date.now()}`;
  await openComposer(page, 'bluesky', text);
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByRole('button', { name: 'Save as Draft' })).toBeHidden();

  const api = await signedIn('a');
  await expect
    .poll(async () => (await listPosts(api)).some((p) => p.content.includes(text)))
    .toBe(true);
  await api.dispose();
  expect(problems).toEqual([]);
});

test('"Post Now" from the composer publishes to the platform', async ({ page }) => {
  // The first publish waits for the Temporal worker: ~25 s on a CI runner.
  test.setTimeout(120_000);
  const problems = watchForErrors(page);
  const text = `[stack ui] post now ${Date.now()}`;
  await openComposer(page, 'mastodon', text);

  await page.getByRole('button', { name: 'Add to calendar' }).hover();
  await page.getByRole('button', { name: 'Post now', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to calendar' })).toBeHidden();

  await expect
    .poll(
      async () => {
        const received: { status: string }[] = await (
          await page.request.get(`${FAKE}/__received`)
        ).json();
        return received.some((r) => r.status.includes(text));
      },
      { timeout: 90_000, intervals: [1_000, 2_000] }
    )
    .toBe(true);
  expect(problems).toEqual([]);
});

// Regressions of E2E-05-04/07/09/22 (fixed 2026-09-26), re-run after the
// ESLint 9 sweep touched these components.
const LINK = `https://example.com/spring-offer?utm_source=newsletter&utm_medium=email&utm_campaign=${'x'.repeat(120)}`;

// One composer per test: on a CI runner a second one in the same test ran
// past the 30 s default.
test('the counter counts a link as 23 on Mastodon', async ({ page }) => {
  test.setTimeout(60_000);
  // 476 + space + link (23) = 500: exactly Mastodon's limit, not over it.
  await openComposer(page, 'mastodon', '');
  await page.keyboard.insertText(`${'a'.repeat(476)} ${LINK}`);
  // Shown twice: the total and the channel's own count.
  await expect(page.getByText('500/500', { exact: true }).first()).toBeVisible();
});

test('the counter counts an emoji as one on Bluesky', async ({ page }) => {
  test.setTimeout(60_000);
  await openComposer(page, 'bluesky', '');
  await page.keyboard.insertText('😀'.repeat(300));
  await expect(page.getByText('300/300', { exact: true }).first()).toBeVisible();
});

test('a long link wraps in the editor instead of pushing it sideways', async ({ page }) => {
  await openComposer(page, 'bluesky', '');
  await page.keyboard.insertText(`Spring offer ${LINK}`);
  const editor = page.locator('.ProseMirror').first();
  const { scroll, client } = await editor.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(scroll).toBeLessThanOrEqual(client + 1);
});

test('a tag created in the composer is saved with the draft', async ({ page }) => {
  const name = `Stack tag ${Date.now()}`;
  const text = `[stack ui] tagged ${Date.now()}`;
  await openComposer(page, 'bluesky', text);
  // The tag button, then the same words at the foot of its menu.
  await page.getByText('Add New Tag', { exact: true }).first().click();
  await page.getByText('Add New Tag', { exact: true }).last().click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible();
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByRole('button', { name: 'Save as Draft' })).toBeHidden();

  const api = await signedIn('a');
  const post = await expect
    .poll(async () => (await listPosts(api)).find((p) => p.content.includes(text)))
    .toBeTruthy()
    .then(async () => (await listPosts(api)).find((p) => p.content.includes(text))!);
  const stored = await (await api.get(`/posts/${post.id}`)).json();
  const tags: { tag: { name: string } }[] = stored.posts[0].tags ?? [];
  expect(tags.map((t) => t.tag.name), JSON.stringify(Object.keys(stored.posts[0]))).toContain(name);
  await api.dispose();
});


// The publish date was a div only a mouse could open, and Escape left its
// calendar open (found at 390 px on 2026-10-06).
test('the publish date opens from the keyboard and Escape closes it', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  const date = page.getByRole('button', { name: /^Publish date: / });
  await date.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Publish date' })).toBeVisible();
  await expect(date).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Publish date' })).toBeHidden();
  // Only the calendar closed, not the composer under it.
  await expect(page.getByText('Create Post', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Are you sure you want to close this modal?')).toHaveCount(0);
});

test('the phone-only Preview button stays out of the desktop composer', async ({ page }) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  await expect(page.getByText('Post Preview', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Preview', exact: true })).toBeHidden();
});
