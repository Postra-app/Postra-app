import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';
import { watchForErrors } from './ui-helpers';

// The Agent's first message vanished on Enter: a message sent before the chat
// had connected to its thread never ran, and the chat input cleared the box
// anyway. A person typing straight after opening the page (or the nightly
// canary) lost it with no run and no word why. The route below holds the
// runtime's "info" back, the way a cold backend answered on production.
// Its own organisation: one agent run at a time per organisation, and other
// specs chat as organisation A in parallel.

const ANSWER = 'Stack AI answer.';

test('a message sent before the chat is ready goes out once it is', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 5,
    channels: 0,
  });
  await context.clearCookies();
  await context.addCookies((await org.api.storageState()).cookies);
  try {
    const problems = watchForErrors(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/copilot/agent', async (route) => {
      if ((route.request().postData() || '').includes('"info"')) {
        await held;
      }
      await route.continue();
    });
    const runs: string[] = [];
    page.on('request', (r) => {
      if (
        r.url().endsWith('/copilot/agent') &&
        (r.postData() || '').includes('"agent/run"')
      ) {
        runs.push(r.url());
      }
    });

    await page.goto('/agents');
    await expect(page).toHaveURL(/\/agents\/[0-9a-f-]{36}$/);
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await expect(input).toBeVisible();
    const question = `First message ${Date.now()}`;
    await input.fill(question);
    await input.press('Enter');

    // Not lost while the chat connects: still in the box, nothing sent yet.
    await page.waitForTimeout(1_000);
    await expect(input).toHaveValue(question);
    expect(runs).toHaveLength(0);

    release();
    const chat = page.locator('.copilotKitMessages');
    await expect(chat.getByText(question)).toBeVisible({ timeout: 20_000 });
    await expect(chat.getByText(ANSWER).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(input).toHaveValue('');
    expect(runs).toHaveLength(1);
    expect(problems).toEqual([]);
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await prisma.$disconnect();
  }
});

// Enter while the chat connects, then an edit: the edited text was sent by
// itself once the chat was ready, a command the person never confirmed.
test('an edit after Enter cancels the waiting send', async ({ page, context }) => {
  test.setTimeout(60_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, {
    tier: 'PRO',
    totalChannels: 5,
    channels: 0,
  });
  await context.clearCookies();
  await context.addCookies((await org.api.storageState()).cookies);
  try {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route('**/api/copilot/agent', async (route) => {
      if ((route.request().postData() || '').includes('"info"')) {
        await held;
      }
      await route.continue();
    });
    const runs: string[] = [];
    page.on('request', (r) => {
      if (
        r.url().endsWith('/copilot/agent') &&
        (r.postData() || '').includes('"agent/run"')
      ) {
        runs.push(r.url());
      }
    });

    await page.goto('/agents');
    const input = page.getByPlaceholder(/Write your (post|message)/);
    await expect(input).toBeVisible();
    await input.fill('Delete all my');
    await input.press('Enter');
    await input.pressSequentially(' drafts');

    release();
    await expect(page.locator('[data-copilotkit-ready="true"]')).toBeVisible({
      timeout: 20_000,
    });
    await page.waitForTimeout(2_000);
    expect(runs).toHaveLength(0);
    await expect(input).toHaveValue('Delete all my drafts');
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
