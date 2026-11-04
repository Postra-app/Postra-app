import { expect, test } from '@playwright/test';
import { listPosts, signedIn, stateFile } from '../helpers';
import { USERS } from '../seed';
import { openComposer, quietSlot, weekOf } from './ui-helpers';

// What the composer asks before it loses work or publishes by surprise.
test.use({ storageState: stateFile('a') });

const FAKE = 'http://localhost:58080';

const openEmptyComposer = async (page: import('@playwright/test').Page) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).first().click();
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor).toBeVisible();
  return editor;
};

// An untouched composer asked "Unsaved changes will be lost",
// which teaches people to click "yes" without reading the one question that
// does protect their work.
test('an untouched composer closes without asking', async ({ page }) => {
  const editor = await openEmptyComposer(page);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Yes, close it!' })).toHaveCount(0);
});

test('a composer with text still asks before closing', async ({ page }) => {
  await openComposer(page, 'bluesky', `Guard close ${Date.now()}`);
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yes, close it!' })).toBeVisible();
});

// A reload or a closed tab dropped the text without a word.
test('leaving the page with text in the composer asks the browser first', async ({ page }) => {
  await openComposer(page, 'bluesky', `Guard leave ${Date.now()}`);
  const asked = new Promise<string>((resolve) =>
    page.once('dialog', async (dialog) => {
      resolve(dialog.type());
      await dialog.dismiss();
    })
  );
  await page.close({ runBeforeUnload: true });
  expect(await asked).toBe('beforeunload');
});

test('leaving the page with an untouched composer does not ask', async ({ page }) => {
  await openEmptyComposer(page);
  let asked = false;
  page.on('dialog', async (dialog) => {
    asked = true;
    await dialog.dismiss();
  });
  await page.close({ runBeforeUnload: true });
  await expect.poll(() => page.isClosed()).toBe(true);
  expect(asked).toBe(false);
});

// A date that has passed made "Add to calendar" publish at once
// (the workflow sleeps 0 ms), while the customer thought it was scheduled.
test('"Add to calendar" with a date that has passed asks, and "Change the date" saves nothing', async ({ page }) => {
  const text = `[stack ui] past date kept ${Date.now()}`;
  await openComposer(page, 'mastodon', text);
  // The composer keeps its date while the clock moves past it.
  await page.clock.setSystemTime(Date.now() + 3 * 24 * 3600_000);

  await page.getByRole('button', { name: /add to calendar/i }).click();
  await expect(page.getByText('This date has passed')).toBeVisible();
  await page.getByRole('button', { name: 'Change the date' }).click();

  await expect(page.getByRole('dialog', { name: 'Post editor' })).toBeVisible();
  const api = await signedIn('a');
  expect((await listPosts(api)).some((p) => p.content.includes(text))).toBe(false);
  await api.dispose();
});

test('"Post now" in the passed-date question publishes it as a post now', async ({ page }) => {
  test.setTimeout(120_000);
  const text = `[stack ui] past date now ${Date.now()}`;
  await openComposer(page, 'mastodon', text);
  await page.clock.setSystemTime(Date.now() + 3 * 24 * 3600_000);

  await page.getByRole('button', { name: /add to calendar/i }).click();
  const saved = page.waitForRequest(
    (r) => r.method() === 'POST' && new URL(r.url()).pathname.endsWith('/posts')
  );
  // The question's own button: the composer's "Post now" shows too while the
  // pointer is still over "Add to calendar".
  await page
    .getByRole('dialog', { name: 'This date has passed' })
    .getByRole('button', { name: 'Post now', exact: true })
    .click();
  expect((await saved).postDataJSON().type).toBe('now');

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
});

// An existing post: closing it untouched needs no question, but a change to
// a channel setting alone (Mastodon's visibility here, a YouTube title or a
// Pinterest board elsewhere) is work the close would lose.
const SLOT = quietSlot(4);

const openMastodonDraft = async (page: import('@playwright/test').Page, content: string) => {
  const api = await signedIn('a');
  const created = await api.post('/posts', {
    data: {
      type: 'draft',
      shortLink: false,
      date: SLOT.toISOString(),
      tags: [],
      posts: [
        {
          integration: { id: USERS.a.mastodon.id },
          value: [{ content, image: [] }],
          settings: { __type: 'mastodon', visibility: 'public' },
        },
      ],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  await api.dispose();
  await page.goto(weekOf(SLOT));
  await page
    .getByRole('button', { name: `Open post: ${USERS.a.mastodon.name}` })
    .filter({ hasText: content })
    .click();
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await expect(editor).toBeVisible();
  return editor;
};

test('an existing post opened and closed untouched does not ask', async ({ page }) => {
  const editor = await openMastodonDraft(page, `[stack ui] untouched ${Date.now()}`);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Yes, close it!' })).toHaveCount(0);
});

test('a changed channel setting alone still asks before closing', async ({ page }) => {
  const editor = await openMastodonDraft(page, `[stack ui] setting ${Date.now()}`);
  await page.getByText(`${USERS.a.mastodon.name} Settings`).click();
  await page.getByLabel('Who can see this post?').selectOption('unlisted');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yes, close it!' })).toBeVisible();
});
