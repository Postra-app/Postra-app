import { Page } from '@playwright/test';

// Console errors and 5xx from our API fail the test: a page can render and
// still be broken underneath.
export const watchForErrors = (page: Page) => {
  const problems: string[] = [];
  page.on('console', (msg) => {
    // The failed response itself is recorded below, with its URL.
    if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) {
      problems.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => problems.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() >= 400) {
      problems.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return problems;
};

export const openComposer = async (page: Page, provider: string, text: string) => {
  await page.goto('/launches');
  await page.getByRole('button', { name: 'Create Post' }).click();
  await page.getByRole('img', { name: provider, exact: true }).first().click();
  await page.getByRole('textbox').first().click();
  await page.keyboard.type(text);
};
