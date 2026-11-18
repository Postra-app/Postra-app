import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';
import { watchForErrors } from './ui-helpers';

// "Prepare a post" in the assistant opens the post editor with the draft.
// With no channel ticked in the side panel (on a phone the panel is hidden,
// so always) the editor never opened: "Opening the editor…" stayed, and the
// page threw reading the channel's picture. The fake model calls the
// browser's manualPosting tool when a message carries
// `stack-manual-posting <channel id>`. Its own organisation: one agent run at
// a time per organisation.

test.use({ storageState: { cookies: [], origins: [] } });

test('the editor opens with the draft when no channel is ticked', async ({ page, context }) => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'bluesky' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    const problems = watchForErrors(page);
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await expect(input).toBeVisible();
    await input.fill(`Prepare a post stack-manual-posting ${org.channelIds[0]}`);
    await input.press('Enter');

    const editor = page.getByRole('dialog', { name: 'Post editor' });
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await expect(editor.getByText('Stack post from the assistant')).toBeVisible();
    expect(problems.filter((p) => /picture|TypeError/.test(p))).toEqual([]);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('a channel that is not connected says so instead of waiting', async ({ page, context }) => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'bluesky' });
  try {
    await context.addCookies((await org.api.storageState()).cookies);
    await page.goto('/agents');
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await input.fill('Prepare a post stack-manual-posting not-a-channel-of-yours');
    await input.press('Enter');
    await expect(page.getByText('That channel is not connected any more')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('dialog', { name: 'Post editor' })).toHaveCount(0);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
