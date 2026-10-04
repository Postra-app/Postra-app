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

// A slot no other spec uses (04:mm local, `days` from today), so the post's
// tile is not folded into a busy calendar cell, and the calendar URL for its
// week.
export const quietSlot = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(4, 10 + Math.floor(Math.random() * 40), 0, 0);
  return d;
};

export const weekOf = (date: Date) => {
  const day = (n: number) => {
    const d = new Date(date);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return `/launches?display=week&startDate=${day(0)}&endDate=${day(6)}`;
};
