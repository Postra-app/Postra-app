import { expect, test } from '@playwright/test';
import { MARKER } from './env';

// "Report a problem" through the real Sentry widget, screenshot included
// (E2E-07-10: every screenshot was dropped on the way to the mail). It files a
// real report: one Sentry feedback event and one mail to the team. Manual:
//   pnpm exec playwright test -c e2e/playwright --project setup --project problem-report

test('a report with a screenshot reaches the backend and the screenshot is kept', async ({ page }) => {
  // A browser under test cannot pick a tab to share, so the screen capture
  // itself is a painted canvas. Everything after it — the widget's editor,
  // its attachment, our hand-off and the backend — is the real thing.
  await page.addInitScript(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const ctx = canvas.getContext('2d')!;
      const paint = () => {
        ctx.fillStyle = '#0a0e1a';
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(40, 40, 200, 120);
      };
      paint();
      setInterval(paint, 50);
      return canvas.captureStream(20);
    };
  });

  await page.goto('/launches');
  await page.getByRole('button', { name: 'Feedback' }).click();
  await page.getByPlaceholder('What went wrong?').fill(`${MARKER} screenshot check, please ignore`);
  await page.getByRole('button', { name: /add a screenshot/i }).click();
  await expect(page.getByRole('button', { name: /remove screenshot/i })).toBeVisible();

  const request = page.waitForRequest((r) => r.url().endsWith('/user/problem-report') && r.method() === 'POST');
  const response = page.waitForResponse((r) => r.url().endsWith('/user/problem-report'));
  await page.getByRole('button', { name: 'Send report' }).click();

  const body = (await request).postDataJSON();
  expect(body.screenshot?.slice(0, 22)).toBe('data:image/png;base64,');
  const res = await response;
  expect(res.status()).toBe(201);
  expect(await res.json()).toMatchObject({ ok: true, screenshot: 'stored' });
});
