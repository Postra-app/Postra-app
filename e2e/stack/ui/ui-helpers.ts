import { expect, Locator, Page } from '@playwright/test';

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

// Drags like a hand does: press, move in steps, release. Locator.dragTo
// jumps to the target in one move, and react-dnd's HTML5 backend then
// sometimes sees no dragover on the cell, so nothing is dropped - the Month
// cell's centre holds the "+" button, which made it fail there every time
// during the day (E2E-01-36).
// A point of the element that is really on top at that spot: the calendar's
// weekday header is sticky, and a cell scrolled under it has a box Playwright
// calls visible while every press there lands on the header.
const visiblePoint = (target: Locator) =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    for (const y of [r.top + 30, r.top + r.height / 2, r.bottom - 20]) {
      const hit = document.elementFromPoint(x, y);
      if (hit && el.contains(hit)) return { x, y };
    }
    return null;
  });

export const dragWithMouse = async (page: Page, from: Locator, to: Locator) => {
  // A tile at the bottom of a crowded day is cut off by the calendar's scroll
  // box: its centre is "visible" to Playwright but the press lands on nothing.
  await from.scrollIntoViewIfNeeded();
  // A busy day makes its week row tall; scrolling the tile into view can then
  // push the target cell of the row above under the sticky header (Month
  // view, a Monday post moved to Sunday: E2E-01-36, 2026-10-15). Drop on a
  // point of the cell that is really there, and scroll it into view if no
  // such point exists.
  let drop = await visiblePoint(to);
  if (!drop) {
    await to.scrollIntoViewIfNeeded();
    drop = await visiblePoint(to);
  }
  const a = (await from.boundingBox())!;
  const start = (await visiblePoint(from)) ?? { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  expect(drop, 'drop target has no visible point').not.toBeNull();
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(drop!.x, drop!.y, { steps: 15 });
  await page.mouse.up();
};
