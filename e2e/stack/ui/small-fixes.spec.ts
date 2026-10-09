import { expect, test } from '@playwright/test';
import { database, signedIn, stateFile } from '../helpers';
import { USERS } from '../seed';

// E2E-05-94: small things found while writing the user guide (2026-10-09).
// Organisation B for the signature, so it cannot leak into A's composer tests.

test.describe('signature in the composer', () => {
  test.use({ storageState: stateFile('b') });

  test('"Use Signature" adds it and closes the Add Signature window', async ({ page }) => {
    const api = await signedIn('b');
    const text = `Small fixes signature ${Date.now()}`;
    const created = await api.post('/signatures', { data: { content: `<p>${text}</p>`, autoAdd: false } });
    expect(created.status()).toBe(201);
    const { id } = await created.json();
    try {
      await page.goto('/launches');
      await page.getByRole('button', { name: 'Create Post' }).click();
      const editor = page.getByRole('dialog', { name: 'Post editor' });
      await editor.locator('[data-tooltip-content="Add Signature"]').first().click();
      await page.getByRole('button', { name: 'Use Signature' }).first().click();
      await expect(editor.locator('.ProseMirror').first()).toContainText(text);
      await expect(page.getByRole('button', { name: 'Use Signature' })).toHaveCount(0);
    } finally {
      await api.delete(`/signatures/${id}`);
      await api.dispose();
    }
  });
});

test.describe('organisation A', () => {
  test.use({ storageState: stateFile('a') });

  test('deleting an Auto Post feed names it', async ({ page }) => {
    const prisma = database();
    const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
    const title = `Small fixes feed ${Date.now()}`;
    const feed = await prisma.autoPost.create({
      data: {
        organizationId: org.id,
        title,
        url: 'https://example.com/small-fixes.xml',
        lastUrl: '',
        onSlot: false,
        syncLast: false,
        active: false,
        addPicture: false,
        generateContent: false,
        integrations: '[]',
      },
    });
    try {
      await page.goto('/autopost');
      await page.getByText(title, { exact: true }).locator('xpath=following-sibling::div').getByRole('button', { name: 'Delete' }).first().click();
      await expect(page.getByText(`Are you sure you want to delete ${title}?`)).toBeVisible();
    } finally {
      await prisma.autoPost.deleteMany({ where: { id: feed.id } });
      await prisma.$disconnect();
    }
  });

  test('a refused revoke of an approved app does not say "Access revoked"', async ({ page }) => {
    await page.route('**/user/approved-apps', (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: [{ id: 'grant-1', createdAt: new Date().toISOString(), oauthApp: { id: 'app-1', name: 'Stack App', description: '', pictureId: null } }] })
        : route.continue()
    );
    await page.route('**/user/approved-apps/grant-1', (route) =>
      route.fulfill({ status: 404, json: { message: 'Not found' } })
    );
    await page.goto('/settings');
    await page.getByRole('tab', { name: /Approved apps/i }).click();
    await page.getByRole('button', { name: /Revoke/ }).first().click();
    await page.getByRole('button', { name: /Yes/ }).click();
    await expect(page.getByText('Failed to revoke access')).toBeVisible();
    await expect(page.getByText('Access revoked')).toHaveCount(0);
  });
});

test.describe('client preview', () => {
  test.use({ storageState: stateFile('a') });

  test('comment authors read "User 1", and an anonymous client sees no load error', async ({ page, browser }) => {
    const api = await signedIn('a');
    const content = `[stack ui] preview comments ${Date.now()}`;
    const created = await api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: new Date(Date.now() + 5 * 86_400_000).toISOString(),
        tags: [],
        posts: [{ type: 'draft', integration: { id: USERS.a.channel.id }, value: [{ content, image: [] }], settings: { __type: 'bluesky' } }],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const posts = await (await api.get(`/posts?startDate=${new Date(Date.now() - 86_400_000).toISOString()}&endDate=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`)).json();
    const post = posts.p.find((p: { c: string }) => p.c.includes(content));
    const comment = await api.post(`/posts/${post.i}/comments`, { data: { comment: 'Looks good' } });
    expect(comment.ok(), await comment.text()).toBe(true);
    const client = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      await page.goto(`/p/${post.i}`);
      await expect(page.getByText('Looks good')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'User 1', exact: true })).toBeVisible();

      // The page asked for /user/self and the assistant without a session:
      // two 401s and "Something went wrong loading data" for every client.
      const anonymous = await client.newPage();
      const refused: string[] = [];
      anonymous.on('response', (r) => r.status() === 401 && refused.push(r.url()));
      await anonymous.goto(`/p/${post.i}`);
      await expect(anonymous.getByText(content)).toBeVisible();
      await anonymous.waitForTimeout(3000);
      await expect(anonymous.getByText('Something went wrong loading data')).toHaveCount(0);
      // /user/self may answer 401: that is how the page learns the viewer is
      // not signed in (and offers to log in to comment).
      expect(refused.filter((url) => !url.endsWith('/api/user/self'))).toEqual([]);
    } finally {
      await client.close();
      await api.delete(`/posts/${post.g}`);
      await api.dispose();
    }
  });
});
