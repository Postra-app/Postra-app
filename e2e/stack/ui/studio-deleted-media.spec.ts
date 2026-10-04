import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

// Opening a design that was deleted from the media library (an old link, a
// second tab): the API answers 404, and Studio used to read that as an empty
// item and open a blank canvas without a word.
test.use({ viewport: { width: 1440, height: 900 } });

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

test('Studio says when the design it was asked to open was deleted', async ({ page }) => {
  const api = await signedIn('a');
  try {
    const up = await api.post('/media/upload-simple', {
      multipart: { file: { name: 'deleted-design.png', mimeType: 'image/png', buffer: PNG } },
    });
    expect(up.status()).toBe(201);
    const { id } = await up.json();
    expect((await api.delete(`/media/${id}`)).status()).toBe(200);

    await page.goto(`/studio?mediaId=${id}`);
    await expect(
      page.getByRole('status').getByText('This design is no longer in your media library')
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    await api.dispose();
  }
});
