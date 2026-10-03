import { expect, test } from '@playwright/test';
import { openComposer, watchForErrors } from './ui-helpers';

// The AI assist ribbon under the composer's editor, clicked like a customer
// would, with fake-openai.mjs answering (stack.env: OPENAI_BASE_URL).

const ANSWER = 'Stack AI answer.';
const TEXT = 'Planning a whole month of posts takes one afternoon with Postra';

test('"Shorten" previews the AI text and "Apply" puts it in the editor', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', TEXT);

  await page.getByRole('button', { name: 'Shorten', exact: true }).click();
  await expect(page.getByText('New text')).toBeVisible();
  await expect(page.getByText(ANSWER).first()).toBeVisible();

  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByRole('textbox').first()).toContainText(ANSWER);
  await expect(page.getByRole('textbox').first()).not.toContainText(TEXT);
  expect(problems).toEqual([]);
});

test('"# Hashtags" suggests tags and adds the picked ones under the text', async ({ page }) => {
  const problems = watchForErrors(page);
  await openComposer(page, 'bluesky', TEXT);

  await page.getByRole('button', { name: '# Hashtags' }).click();
  // The server turns the model's answer into a clean tag.
  const tag = '#StackAIanswer';
  await expect(page.getByRole('button', { name: tag })).toBeVisible();

  // Suggestions arrive picked; "Add to post" appends them.
  await page.getByRole('button', { name: 'Add to post' }).click();
  await expect(page.getByRole('textbox').first()).toContainText(tag);
  await expect(page.getByRole('textbox').first()).toContainText(TEXT);
  expect(problems).toEqual([]);
});

test('with OpenAI down, "Shorten" says AI is unavailable and leaves the text alone', async ({ page, request }) => {
  const OUTAGE = 'stack-openai-outage-ui';
  const text = `${TEXT} ${OUTAGE}`;
  const problems = watchForErrors(page);
  await request.post('http://localhost:58090/__outage', { data: { match: OUTAGE, on: true } });
  try {
    await openComposer(page, 'bluesky', text);
    await page.getByRole('button', { name: 'Shorten', exact: true }).click();
    await expect(page.getByText('AI is unavailable right now')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('textbox').first()).toContainText(text);
    // The 503 itself is the expected answer; nothing else may fail.
    expect(problems.filter((p) => !/^503 POST .*\/media\/ai-edit$/.test(p))).toEqual([]);
  } finally {
    await request.post('http://localhost:58090/__outage', { data: { match: OUTAGE, on: false } });
  }
});
