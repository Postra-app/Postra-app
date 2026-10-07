import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

// E2E-08-42: settings that save on click could save out of order or twice.
// E2E-05-73: the on/off switches were divs a keyboard never reached.

// The first two change the same user's settings: one at a time, or one
// restores what the other is about to read (the stack runs fully parallel).
test.describe.configure({ mode: 'serial' });

const settings = async () => {
  const api = await signedIn('a');
  const read = async () =>
    (await (await api.get('/user/email-notifications')).json()) as {
      sendSuccessEmails: boolean;
      sendFailureEmails: boolean;
    };
  return { api, read };
};

test('E2E-08-42: two quick toggles save in the order clicked', async ({
  page,
}) => {
  const { api, read } = await settings();
  const before = await read();
  try {
    // The first save answers late: it used to land after the second and
    // put the second switch back.
    let n = 0;
    await page.route('**/user/email-notifications', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      if (n++ === 0) await new Promise((r) => setTimeout(r, 1_500));
      return route.continue();
    });
    await page.goto('/settings');
    let answered = 0;
    page.on('response', (r) => {
      if (
        r.url().includes('/user/email-notifications') &&
        r.request().method() === 'POST'
      )
        answered++;
    });
    await page.getByRole('switch', { name: 'Success emails' }).click();
    await page.getByRole('switch', { name: 'Failure emails' }).click();
    // Read once both saves have answered: polling earlier could catch the
    // moment between the second save and the late first one.
    await expect.poll(() => answered, { timeout: 10_000 }).toBe(2);
    expect(await read()).toEqual({
      sendSuccessEmails: !before.sendSuccessEmails,
      sendFailureEmails: !before.sendFailureEmails,
    });
  } finally {
    await api.post('/user/email-notifications', { data: before });
    await api.dispose();
  }
});

test('E2E-05-73: a switch turns from the keyboard and says its state', async ({
  page,
}) => {
  const { api, read } = await settings();
  const before = await read();
  try {
    await page.goto('/settings');
    const success = page.getByRole('switch', { name: 'Success emails' });
    await expect(success).toHaveAttribute(
      'aria-checked',
      String(before.sendSuccessEmails)
    );
    await success.focus();
    await page.keyboard.press('Space');
    await expect(success).toHaveAttribute(
      'aria-checked',
      String(!before.sendSuccessEmails)
    );
    await expect
      .poll(async () => (await read()).sendSuccessEmails)
      .toBe(!before.sendSuccessEmails);
  } finally {
    await api.post('/user/email-notifications', { data: before });
    await api.dispose();
  }
});

test('E2E-08-42: one secret rotation at a time', async ({ page }) => {
  const api = await signedIn('a');
  const existing = await (await api.get('/user/oauth-app')).json();
  if (!existing) {
    const created = await api.post('/user/oauth-app', {
      data: {
        name: 'Stack rotation app',
        redirectUrl: 'https://example.com/callback',
      },
    });
    expect(created.status(), await created.text()).toBe(201);
  }
  try {
    let rotations = 0;
    await page.route('**/user/oauth-app/rotate-secret', async (route) => {
      rotations++;
      await new Promise((r) => setTimeout(r, 1_500));
      return route.continue();
    });
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Developers' }).click();
    await page.getByRole('button', { name: 'Apps', exact: true }).click();
    const rotate = page.getByRole('button', { name: 'Rotate Secret' });
    await rotate.click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    // While the first rotation is still in flight, a second click opens
    // nothing and sends nothing.
    await rotate.click();
    await expect(
      page.getByRole('button', { name: 'Generate', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByText('Secret generated! Copy the new client secret now.')
    ).toBeVisible();
    expect(rotations).toBe(1);
  } finally {
    if (!existing) await api.delete('/user/oauth-app');
    await api.dispose();
  }
});
