import { expect, test } from '@playwright/test';
import { signedIn, stateFile } from '../helpers';

// A signature marked "auto add" is already in a new post's editor (S2). The
// main "Create Post" button skipped it; only a click on a calendar cell added
// it. Organisation B, so the signature cannot leak into the other UI tests,
// which run in parallel as A.
test.use({ storageState: stateFile('b') });

test('an auto-add signature is in a new post from the start', async ({ page }) => {
  const api = await signedIn('b');
  const text = `Stack signature ${Date.now()}`;
  const created = await api.post('/signatures', { data: { content: `<p>${text}</p>`, autoAdd: true } });
  expect(created.status()).toBe(201);
  const { id } = await created.json();
  try {
    await page.goto('/launches');
    await page.getByRole('button', { name: 'Create Post' }).click();
    await expect(page.locator('.ProseMirror').first()).toContainText(text);
  } finally {
    await api.delete(`/signatures/${id}`);
    await api.dispose();
  }
});
