import { expect, test } from '@playwright/test';
import { openComposer } from './ui-helpers';

// A refused AI call (403: the hour after signup, a role too low) is reported
// once, by the shared fetch, with the server's reason. The composer's AI
// Image then added "Could not generate the image, please try again." under
// it, which told the customer to do the one thing that could not work.

test.use({ viewport: { width: 1280, height: 800 } });

const REASON = 'AI tools unlock one hour after signup, in 42 minutes. Try our templates in the meantime!';

test('a refused AI image shows the reason and nothing else', async ({ page }) => {
  await page.route('**/api/media/generate-image-with-prompt', (route) =>
    route.fulfill({ status: 403, json: { statusCode: 403, message: REASON } })
  );
  await openComposer(page, 'bluesky', 'A post that wants a picture');

  await page.getByRole('button', { name: 'AI Image', exact: true }).click();
  await page.getByPlaceholder('Describe the image you want to generate').fill('A paper boat');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  const toasts = page.getByRole('status');
  await expect(toasts.getByText(REASON)).toBeVisible();
  // the second toast came right after the first; give it the time to come
  await page.waitForTimeout(1_500);
  expect((await toasts.allInnerTexts()).join('\n')).not.toMatch(/try again/i);
});
