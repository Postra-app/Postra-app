import { expect, test } from '@playwright/test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { database, throwawayOrg } from '../helpers';

dayjs.extend(utc);
dayjs.extend(timezone);

// The timezone is a setting of the account, not of the machine: someone in
// Tokyo opening Postra on a laptop still set to London sees their posts on
// Tokyo's clock. With the two different, the day view lost the post (the row
// and the post were read on different clocks). A throwaway account, so no
// other test sees its timezone.
test.use({ storageState: { cookies: [], origins: [] }, timezoneId: 'Europe/London' });

test('the calendar follows the timezone chosen in Settings', async ({ page, context }) => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const saved = await owner.api.post('/user/timezone', {
      data: { timezoneName: 'Asia/Tokyo' },
    });
    expect(saved.status(), await saved.text()).toBe(201);

    // 00:30 in Tokyo is 15:30 the day before in London.
    const day = dayjs().tz('Asia/Tokyo').add(5, 'day').format('YYYY-MM-DD');
    const text = `Tokyo post ${Date.now()}`;
    const created = await owner.api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: dayjs.tz(`${day} 00:30`, 'Asia/Tokyo').toISOString(),
        tags: [],
        posts: [
          {
            type: 'draft',
            integration: { id: owner.channelIds[0] },
            value: [{ content: text, image: [] }],
            settings: { __type: 'bluesky' },
          },
        ],
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    await context.addCookies((await owner.api.storageState()).cookies);
    const tile = page.locator('[role=button]', { hasText: text });

    await page.goto(`/launches?display=day&startDate=${day}&endDate=${day}`);
    await expect(tile).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('00:30', { exact: true })).toBeVisible();

    // The week (Monday to Sunday) holding that day.
    const weekStart = dayjs(day).subtract((dayjs(day).day() + 6) % 7, 'day');
    await page.goto(
      `/launches?display=week&startDate=${weekStart.format('YYYY-MM-DD')}&endDate=${weekStart
        .add(6, 'day')
        .format('YYYY-MM-DD')}`
    );
    await expect(tile).toBeVisible({ timeout: 20_000 });

    // Settings shows the choice and puts the browser's timezone back.
    await page.goto('/settings');
    const select = page.getByRole('combobox', { name: 'Timezone' });
    await expect(select).toHaveValue('Asia/Tokyo');
    await expect(select.locator('option[value=""]')).toHaveText('Automatic (Europe/London)');
    await Promise.all([page.waitForEvent('load'), select.selectOption('')]);
    const self = await (await owner.api.get('/user/self')).json();
    expect(self.timezoneName).toBeNull();
  } finally {
    await owner.remove();
    await prisma.$disconnect();
  }
});
