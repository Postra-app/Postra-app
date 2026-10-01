import { expect, Page, test } from '@playwright/test';
import { listPosts, signedIn } from '../helpers';
import { USERS } from '../seed';

// The customer's main path in a real browser against the local stack:
// calendar → composer → draft, and → "Post Now" all the way to the platform
// (the fake Mastodon). On production only the draft half may ever run.

const FAKE = 'http://localhost:58080';

// Console errors and 5xx from our API fail the test: a page can render and
// still be broken underneath.
const watchForErrors = (page: Page) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    // The failed response itself is recorded below, with its URL.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      problems.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) {
      problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return problems;
};

const openComposer = async (page: Page, provider: string, text: string) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).click();
  await page.getByRole('img', { name: provider, exact: true }).first().click();
  await page.getByRole('textbox').first().click();
  await page.keyboard.type(text);
};

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
  await page.getByRole('button', { name: 'Post Now' }).click();
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
