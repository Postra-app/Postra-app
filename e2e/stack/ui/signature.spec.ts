import { expect, Page, test } from '@playwright/test';
import { signedIn, stateFile } from '../helpers';

// A signature marked "auto add" is already in a new post's editor (S2). The
// main "Create Post" button skipped it; only a click on a calendar cell added
// it. Organisation B, so the signature cannot leak into the other UI tests,
// which run in parallel as A. Serial: a set in B would put the set picker in
// front of the signature tests.
test.use({ storageState: stateFile('b') });
test.describe.configure({ mode: 'serial' });

// Holds every response of `path` until the returned function is called, so a
// click can land before the page has the data.
const holdResponses = async (page: Page, path: string) => {
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${path}`, async (route) => {
    await released;
    await route.continue();
  });
  return release;
};

const withSignature = async (run: (text: string) => Promise<void>) => {
  const api = await signedIn('b');
  const text = `Stack signature ${Date.now()}`;
  const created = await api.post('/signatures', { data: { content: `<p>${text}</p>`, autoAdd: true } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    await run(text);
  } finally {
    await api.delete(`/signatures/${id}`);
    await api.dispose();
  }
};

test('an auto-add signature is in a new post from the start', async ({ page }) => {
  await withSignature(async (text) => {
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    await expect(page.locator('.ProseMirror').first()).toContainText(text);
  });
});

test('"Create Post" clicked before the signature has loaded still adds it', async ({ page }) => {
  await withSignature(async (text) => {
    const release = await holdResponses(page, '/signatures/default');
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    // Long enough for the composer to have opened without waiting.
    await page.waitForTimeout(1500);
    release();
    await expect(page.locator('.ProseMirror').first()).toContainText(text);
  });
});

test('"Create Post" clicked before the sets have loaded still asks for a set', async ({ page }) => {
  const api = await signedIn('b');
  const name = `Stack set ${Date.now()}`;
  const created = await api.post('/sets', { data: { name, content: '{}' } });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();
  try {
    const release = await holdResponses(page, '/sets');
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    await page.waitForTimeout(1500);
    release();
    await expect(page.getByText('Select a Set')).toBeVisible();
    await expect(page.getByText(name)).toBeVisible();
  } finally {
    await api.delete(`/sets/${id}`);
    await api.dispose();
  }
});
