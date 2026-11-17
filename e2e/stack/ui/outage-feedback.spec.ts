import { expect, test } from '@playwright/test';

// A failure must say something. These screens used to
// show nothing at all when the server did not answer as expected.

// /user/self not answering when the app opens (a deploy, the database failing
// over) left a blank page for good.
test('the app says it cannot load, and Try again brings it back', async ({ page }) => {
  let fail = true;
  await page.route('**/api/user/self', (route) =>
    fail ? route.fulfill({ status: 503, json: { message: 'unavailable' } }) : route.fallback()
  );
  await page.goto('/launches');
  await expect(page.getByText("Can't load Postra")).toBeVisible({ timeout: 20_000 });
  fail = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText("Can't load Postra")).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#left-menu')).toBeVisible();
});

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The sign-in screen had no toaster: a 5xx answered with silence.
  test('signing in while the server is down says so', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 503, body: '<html>Service Unavailable</html>', contentType: 'text/html' })
    );
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('nobody@example.com');
    await page.getByRole('textbox', { name: 'Password' }).fill('Some-password-1');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('The server is temporarily unavailable - please try again in a moment.')).toBeVisible();
  });

  // Cancelling the Google sign-in ended on "Could not add provider. You
  // declined the connection request." with no way back.
  test('a Google sign-in cancelled at Google goes back to signing in', async ({ page }) => {
    await page.goto('/integrations/social/youtube?error=access_denied&state=auth-abc');
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  // "Continue with Google" was a div: Tab skipped it.
  test('Continue with Google is a button the keyboard reaches', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByRole('button', { name: /Google/ })).toBeVisible();
  });
});

// Over the plan's channel limit the return from the platform answers 402; the
// "Payment required" dialog had nowhere to be drawn and "Adding Channel" spun
// for good.
test('connecting over the channel limit asks about the plan, then says what happened', async ({ page }) => {
  await page.route('**/api/integrations/social-connect/bluesky/handoff*', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/integrations/social-connect/bluesky', (route) =>
    route.fulfill({ status: 402, json: { message: 'You have reached the maximum number of channels for your plan' } })
  );
  await page.goto('/integrations/social/bluesky?code=c&state=s');
  await expect(page.getByText('Payment required')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'No, cancel!' }).click();
  await expect(page.getByText('You have reached the maximum number of channels for your plan')).toBeVisible();
  await expect(page.getByText('Adding Channel')).toHaveCount(0);
});

// Choosing the page to connect: a refused save (409, the page is in another
// Postra account) showed nothing, the picker stayed as if nothing happened.
test('a page that cannot be saved says why', async ({ page }) => {
  await page.route('**/api/integrations/social-connect/facebook/handoff*', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/integrations/social-connect/facebook', (route) =>
    route.fulfill({
      json: {
        inBetweenSteps: true,
        id: 'stack-two-step',
        pages: [{ id: 'p1', name: 'Corner Cafe', username: 'cafe', picture: { data: { url: '/postra-icon.webp' } } }],
      },
    })
  );
  const saves: string[] = [];
  await page.route('**/api/integrations/provider/stack-two-step/connect', (route) => {
    saves.push(route.request().method());
    return route.fulfill({ status: 409, json: { message: 'This Page is already connected to another Postra account.' } });
  });
  await page.goto('/integrations/social/facebook?code=c&state=s');
  await page.getByText('Corner Cafe').click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'This Page is already connected to another Postra account.' })).toBeVisible();
  await expect(page.getByText('Corner Cafe')).toBeVisible();
  expect(saves).toEqual(['POST']);
});

// The return page mounts its own dialogs; moving on to the calendar left its
// confirmation listener behind, and every question after it opened twice.
test('after connecting a channel, a question in the calendar opens once', async ({ page }) => {
  await page.route('**/api/integrations/social-connect/bluesky/handoff*', (route) => route.fulfill({ json: {} }));
  await page.route('**/api/integrations/social-connect/bluesky', (route) =>
    route.fulfill({ json: { id: 'stack-connected', inBetweenSteps: false } })
  );
  await page.goto('/integrations/social/bluesky?code=c&state=s');
  await expect(page).toHaveURL(/\/launches/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Create Post' }).first().click({ timeout: 20_000 });
  const editor = page.getByRole('dialog', { name: 'Post editor' });
  await editor.locator('.ProseMirror').first().fill('A draft that asks before closing');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Yes, close it!' })).toHaveCount(1);
});
