import { expect, test } from '@playwright/test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { draftBody, listPosts, signedIn, stateFile } from '../helpers';

dayjs.extend(utc);
dayjs.extend(timezone);

// E2E-05-61: in Europe/Warsaw a post at 00:20 was missing from its own day
// view — the row came out as the next day at 00:20. Organisation B, so the
// draft is not under the other UI tests' clicks.
test.use({ storageState: stateFile('b'), timezoneId: 'Europe/Warsaw' });

test('a post just after local midnight shows in that day', async ({ page }) => {
  const api = await signedIn('b');
  const text = `Midnight post ${Date.now()}`;
  const day = dayjs().tz('Europe/Warsaw').add(5, 'day').format('YYYY-MM-DD');
  const res = await api.post('/posts', {
    data: draftBody('b', text, {
      date: dayjs.tz(`${day} 00:20`, 'Europe/Warsaw').toISOString(),
    }),
  });
  expect(res.status(), await res.text()).toBe(201);
  const post = (await listPosts(api)).find((p) => p.content.includes(text))!;
  try {
    await page.goto(`/launches?display=day&startDate=${day}&endDate=${day}`);
    await expect(page.locator('[role=button]', { hasText: text })).toBeVisible();
    await expect(page.getByText('00:20', { exact: true })).toBeVisible();
  } finally {
    await api.delete(`/posts/${post.group}`);
    await api.dispose();
  }
});
