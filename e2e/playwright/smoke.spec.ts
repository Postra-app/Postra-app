import { APIRequestContext, expect, Page, test } from '@playwright/test';
import { MARKER } from './env';

// The post-deploy smoke: the path a customer takes first — calendar, composer,
// a draft saved and deleted. Drafts only; nothing here may publish.

const CHANNEL = process.env.E2E_CHANNEL || 'bluesky';

type MiniPost = { id: string; group: string; content: string };

// GET /posts answers in the minified calendar shape: { p: [{ i, c, g, … }] }.
type Minified = { p: { i: string; c: string; g: string }[] };

const listPosts = async (request: APIRequestContext): Promise<MiniPost[]> => {
  const from = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const res = await request.get(`/api/posts?startDate=${from}&endDate=${to}`);
  expect(res.ok(), 'GET /posts').toBeTruthy();
  const body: Minified = await res.json();
  return body.p.map((p) => ({ id: p.i, group: p.g, content: p.c }));
};

const deleteLeftovers = async (request: APIRequestContext) => {
  const leftovers = (await listPosts(request)).filter((p) =>
    p.content?.includes(MARKER)
  );
  for (const group of new Set(leftovers.map((p) => p.group))) {
    await request.delete(`/api/posts/${group}`);
  }
};

// Console errors and 5xx from our API fail the test: a page can render and
// still be broken underneath.
const watchForErrors = (page: Page) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') problems.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 500 && res.url().includes('/api/')) {
      problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return problems;
};

test.afterAll(async ({ request }) => {
  await deleteLeftovers(request);
});

test('calendar → composer → draft saved → draft deleted', async ({
  page,
  request,
}) => {
  const problems = watchForErrors(page);
  const text = `${MARKER} ${
    process.env.GITHUB_SHA?.slice(0, 7) || 'local'
  } ${Date.now()}`;

  await test.step('calendar renders with a channel', async () => {
    await page.goto('/launches');
    await expect(
      page.getByRole('heading', { name: 'Calendar', level: 1 })
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Create Post' })
    ).toBeVisible();
  });

  await test.step('composer saves a draft', async () => {
    await page.getByRole('button', { name: 'Create Post' }).click();
    await page.getByRole('img', { name: CHANNEL, exact: true }).first().click();
    await page.getByRole('textbox').first().click();
    await page.keyboard.type(text);
    await page.getByRole('button', { name: 'Save as draft' }).click();
    await expect(
      page.getByRole('button', { name: 'Save as draft' })
    ).toBeHidden();
  });

  await test.step('the draft exists', async () => {
    await expect
      .poll(async () =>
        (await listPosts(request)).some((p) => p.content?.includes(text))
      )
      .toBe(true);
  });

  await test.step('the draft is deleted from the calendar', async () => {
    const tile = page.getByText(text).first();
    // The composer picks the next free slot, which on a Sunday evening lands
    // outside the week on screen. Delete through the API then, and say so.
    if (!(await tile.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.info().annotations.push({
        type: 'note',
        description: 'draft outside the visible week — deleted via API',
      });
      await deleteLeftovers(request);
    } else {
      await tile.click();
      await page.getByRole('button', { name: 'Delete Post' }).click();
      await page.getByRole('button', { name: 'Yes, delete it!' }).click();
    }
    await expect
      .poll(async () =>
        (await listPosts(request)).some((p) => p.content?.includes(text))
      )
      .toBe(false);
  });

  expect(problems, 'errors while the test ran').toEqual([]);
});
