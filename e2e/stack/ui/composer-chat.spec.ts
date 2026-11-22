import { readFileSync } from 'node:fs';
import { expect, Page, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';
import { openComposer, watchForErrors } from './ui-helpers';

const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// The assistant in the corner of the composer, used like a customer would:
// ask, read the draft, "Use in post", change your mind. fake-openai.mjs
// answers (stack.env: OPENAI_BASE_URL).

const ANSWER = 'Stack AI answer.';
// fake-openai.mjs CHAT_MARKUP
const MARKUP = '<script>window.__chatXss=1</script> Tom & Co <b>bold</b>';
const TEXT = 'Planning a whole month of posts takes one afternoon with Postra';

const ask = async (page: Page, question: string) => {
  await page.getByRole('button', { name: 'Open the AI assistant' }).click();
  const chat = page.getByRole('dialog', { name: '✨ AI Assistant' });
  await expect(chat).toBeVisible();
  await chat.getByRole('textbox', { name: 'Message to the assistant' }).fill(question);
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  return chat;
};

test('an empty composer: ask for a post, "Use in post" writes it, "Undo" takes it back', async ({ page }) => {
  const problems = watchForErrors(page);
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).click();
  await page.getByRole('img', { name: 'bluesky', exact: true }).first().click();
  const editor = page.getByRole('textbox').first();

  const chat = await ask(page, 'Write a post about planning a month of content');
  await expect(chat.getByText('Write a post about planning a month of content')).toBeVisible();
  const draft = chat.getByTestId('assistant-draft');
  await expect(draft).toContainText(ANSWER);
  // Nothing reaches the post until the button.
  await expect(editor).not.toContainText(ANSWER);

  await draft.getByRole('button', { name: 'Use in post' }).click();
  await expect(editor).toContainText(ANSWER);

  await draft.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).not.toContainText(ANSWER);
  await expect(draft.getByRole('button', { name: 'Use in post' })).toBeVisible();
  expect(problems).toEqual([]);
});

test('a written post: the draft replaces it, Undo brings the customer\'s own words back, the ribbon still works', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', TEXT);
  const editor = page.getByRole('textbox').first();

  const chat = await ask(page, 'Make it shorter');
  const draft = chat.getByTestId('assistant-draft');
  await draft.getByRole('button', { name: 'Use in post' }).click();
  await expect(editor).toContainText(ANSWER);
  await expect(editor).not.toContainText(TEXT);

  await draft.getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText(TEXT);
  await expect(editor).not.toContainText(ANSWER);

  // Closing the chat leaves the composer as it was: the ribbon under the
  // editor is still there and still rewrites.
  await chat.getByRole('button', { name: 'Close the assistant' }).click();
  await expect(chat).toBeHidden();
  await page.getByRole('button', { name: 'Shorten', exact: true }).click();
  await expect(page.getByText('New text')).toBeVisible();
  expect(problems).toEqual([]);
});

test('a thread from the chat replaces the thread, and Undo restores every post', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Turn it into a thread stack-chat-thread');
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(2);
  // parts of a thread go in together, not one by one
  await expect(chat.getByRole('button', { name: 'Use in post' })).toHaveCount(0);

  await chat.getByRole('button', { name: 'Use as thread' }).click();
  const editors = page.getByRole('dialog', { name: 'Post editor' }).locator('[contenteditable="true"]');
  await expect(editors).toHaveCount(2);
  await expect(editors.nth(0)).toContainText('Thread part one.');
  await expect(editors.nth(1)).toContainText('Thread part two.');

  await chat.getByRole('button', { name: 'Undo' }).click();
  await expect(editors).toHaveCount(1);
  await expect(editors.nth(0)).toContainText(TEXT);
  expect(problems).toEqual([]);
});

test('variants are picked one at a time, and Undo goes back to what was there before the last pick', async ({ page }) => {
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Give me two options stack-chat-variants');
  const drafts = chat.getByTestId('assistant-draft');
  await expect(drafts).toHaveCount(2);
  await expect(chat.getByRole('button', { name: 'Use as thread' })).toHaveCount(0);
  const editor = page.getByRole('textbox').first();

  await drafts.nth(0).getByRole('button', { name: 'Use in post' }).click();
  await expect(editor).toContainText('Variant A text.');
  await drafts.nth(1).getByRole('button', { name: 'Use in post' }).click();
  await expect(editor).toContainText('Variant B text.');
  await expect(editor).not.toContainText('Variant A text.');
  // one Undo in the whole chat: on the draft that is in the post now
  await expect(chat.getByRole('button', { name: 'Undo' })).toHaveCount(1);
  await drafts.nth(1).getByRole('button', { name: 'Undo' }).click();
  await expect(editor).toContainText('Variant A text.');
  // still one post: a variant is not a second part
  await expect(page.getByRole('dialog', { name: 'Post editor' }).locator('[contenteditable="true"]')).toHaveCount(1);
});

test('a question back from the assistant has no draft and no button', async ({ page }) => {
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Help me stack-chat-question');
  await expect(chat.getByText('Which channel is it for?')).toBeVisible();
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(0);
  await expect(chat.getByRole('button', { name: 'Use in post' })).toHaveCount(0);
  await expect(page.getByRole('textbox').first()).toContainText(TEXT);
});

test('markup in a draft is text, in the chat and in the post', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Write it stack-chat-markup');
  const draft = chat.getByTestId('assistant-draft');
  await expect(draft).toContainText(MARKUP);
  await expect(draft.locator('script, b')).toHaveCount(0);

  await draft.getByRole('button', { name: 'Use in post' }).click();
  const editor = page.getByRole('textbox').first();
  await expect(editor).toContainText(MARKUP);
  await expect(editor.locator('script, b')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__chatXss)).toBeUndefined();
  expect(problems).toEqual([]);
});

test('a channel with its own version: the draft goes there, the shared text stays', async ({ page }) => {
  await openComposer(page, 'bluesky', TEXT);
  const modal = page.getByRole('dialog', { name: 'Post editor' });
  // the channel's tab, then its own version
  await modal.getByRole('button', { name: 'Stack Bluesky A', exact: true }).click();
  await modal.getByRole('button', { name: 'Edit content' }).click();

  const chat = await ask(page, 'Write one for this channel');
  await chat.getByTestId('assistant-draft').getByRole('button', { name: 'Use in post' }).click();
  await expect(page.getByRole('textbox').first()).toContainText(ANSWER);
  await chat.getByRole('button', { name: 'Close the assistant' }).click();

  // back on the shared text: untouched
  await modal.getByRole('button', { name: 'Text for all channels' }).click();
  await expect(page.getByRole('textbox').first()).toContainText(TEXT);
  await expect(page.getByRole('textbox').first()).not.toContainText(ANSWER);
});

test('"New chat" empties the conversation and leaves the post alone', async ({ page }) => {
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Write something');
  await chat.getByTestId('assistant-draft').getByRole('button', { name: 'Use in post' }).click();
  await chat.getByRole('button', { name: 'New chat' }).click();
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(0);
  await expect(chat.getByText('Write something')).toHaveCount(0);
  await expect(chat.getByText("I'll help you write a great social media post")).toBeVisible();
  await expect(page.getByRole('textbox').first()).toContainText(ANSWER);
});

test('Shift+Enter is a new line, an empty message does not send, the chat survives being closed', async ({ page, request }) => {
  const marker = `stack-chat-keys-${Date.now()}`;
  await openComposer(page, 'bluesky', TEXT);
  await page.getByRole('button', { name: 'Open the AI assistant' }).click();
  const chat = page.getByRole('dialog', { name: '✨ AI Assistant' });
  const input = chat.getByRole('textbox', { name: 'Message to the assistant' });
  await expect(input).toBeFocused();
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
  await input.press('Enter');
  await input.fill('   ');
  await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();

  await input.fill(`line one ${marker}`);
  await input.press('Shift+Enter');
  await input.pressSequentially('line two');
  await expect(input).toHaveValue(`line one ${marker}\nline two`);
  await input.press('Enter');
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(1);
  expect((await (await request.get(`http://localhost:58090/__seen?text=${marker}`)).json()).count).toBe(1);

  // closed with the round button and opened again: the conversation is there
  await page.getByRole('button', { name: 'Close the assistant' }).last().click();
  await expect(chat).toBeHidden();
  await page.getByRole('button', { name: 'Open the AI assistant' }).click();
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(1);
});

test('the chat passes axe, open and with a draft in it', async ({ page }) => {
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, 'Write a post');
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(1);
  await page.evaluate(AXE);
  const found = await page.evaluate(async () => {
    const result = await (window as any).axe.run(
      { include: [['.composer-chat']] },
      { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }
    );
    return result.violations
      .filter((v: any) => v.impact === 'critical' || v.impact === 'serious')
      .map((v: any) => `${v.id} ×${v.nodes.length}: ${v.nodes[0].target.join(' ')}`);
  });
  expect(found).toEqual([]);
});

test('the chat brings no chat library with it', async ({ page }) => {
  // The one it replaces cost every page ~0.5 MB of CopilotKit. This one is
  // part of the composer: opening and using it downloads no script at all.
  await openComposer(page, 'bluesky', TEXT);
  await page.waitForLoadState('networkidle');
  const scripts: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'script') scripts.push(req.url().split('/').pop()!);
  });
  const chat = await ask(page, 'Write a post');
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(1);
  expect(scripts).toEqual([]);
});

test.describe('a trial an hour old', () => {
  test('is told when AI unlocks, in the chat', async ({ browser }) => {
    const prisma = database();
    const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 1, isTrailing: true });
    try {
      await prisma.user.update({ where: { id: trial.userId }, data: { createdAt: new Date() } });
      const context = await browser.newContext({ baseURL: 'http://localhost:54000' });
      await context.addCookies((await trial.api.storageState()).cookies);
      const page = await context.newPage();
      await page.goto('/launches');
      await page.getByRole('button', { name: 'Create Post' }).click();
      const chat = await ask(page, 'Write a post');
      // said once, by the app's own notice, with the minutes left
      await expect(page.getByText(/AI tools unlock one hour after signup, in \d+ minutes?/)).toBeVisible();
      await expect(chat.getByText('Writing…')).toBeHidden();
      await expect(chat.getByTestId('assistant-draft')).toHaveCount(0);
      await context.close();
    } finally {
      await trial.remove();
      await prisma.$disconnect();
    }
  });
});

test('Enter sends, and a second question carries the conversation', async ({ page, request }) => {
  const marker = `stack-chat-turns-${Date.now()}`;
  await openComposer(page, 'bluesky', TEXT);
  const chat = await ask(page, `First question ${marker}`);
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(1);

  const input = chat.getByRole('textbox', { name: 'Message to the assistant' });
  await input.fill('And a friendlier one');
  await input.press('Enter');
  await expect(chat.getByTestId('assistant-draft')).toHaveCount(2);
  await expect(input).toHaveValue('');

  // Both calls carried the first question: the second one as history.
  const seen = await (await request.get(`http://localhost:58090/__seen?text=${marker}`)).json();
  expect(seen.count).toBe(2);
});

test('with OpenAI down the chat says so and the post is left alone', async ({ page, request }) => {
  const OUTAGE = 'stack-openai-outage-chat';
  const problems = watchForErrors(page);
  await request.post('http://localhost:58090/__outage', { data: { match: OUTAGE, on: true } });
  try {
    await openComposer(page, 'bluesky', TEXT);
    const chat = await ask(page, `Write something ${OUTAGE}`);
    await expect(page.getByText('AI is unavailable right now')).toBeVisible({ timeout: 30_000 });
    await expect(chat.getByTestId('assistant-draft')).toHaveCount(0);
    await expect(page.getByRole('textbox').first()).toContainText(TEXT);
    // the question is still there to send again
    await expect(chat.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
    expect(problems.filter((p) => !/^503 POST .*\/media\/ai-chat$/.test(p))).toEqual([]);
  } finally {
    await request.post('http://localhost:58090/__outage', { data: { match: OUTAGE, on: false } });
  }
});

test('on a phone the button does not sit on top of the composer\'s own buttons', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openComposer(page, 'bluesky', TEXT);
  const bubble = page.getByRole('button', { name: 'Open the AI assistant' });
  await expect(bubble).toBeVisible();
  const box = (await bubble.boundingBox())!;
  // Whatever is under the middle of the bubble is the bubble.
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label'),
    [box.x + box.width / 2, box.y + box.height / 2]
  );
  expect(top).toBe('Open the AI assistant');
  for (const name of ['Add to Calendar', 'Save as draft', 'Add New Tag', 'Repeat Post Every', 'Check tone', 'Translate']) {
    const other = page.getByRole('button', { name }).first();
    if (!(await other.isVisible().catch(() => false))) continue;
    const b = (await other.boundingBox())!;
    const overlap =
      box.x < b.x + b.width && b.x < box.x + box.width && box.y < b.y + b.height && b.y < box.y + box.height;
    expect(overlap, `the assistant button covers "${name}"`).toBe(false);
  }

  // Opened, the chat takes the screen and can be used and closed.
  await bubble.click();
  const chat = page.getByRole('dialog', { name: '✨ AI Assistant' });
  await chat.getByRole('textbox', { name: 'Message to the assistant' }).fill('Write a post');
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await chat.getByTestId('assistant-draft').getByRole('button', { name: 'Use in post' }).click();
  await chat.getByRole('button', { name: 'Close the assistant' }).click();
  await expect(chat).toBeHidden();
  await expect(page.getByRole('textbox').first()).toContainText(ANSWER);
});
