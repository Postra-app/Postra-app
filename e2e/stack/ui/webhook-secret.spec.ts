import { expect, test } from '@playwright/test';
import { channelOf, signedIn } from '../helpers';

// E2E-08-49: the secret that signs a webhook's deliveries is in Settings →
// Webhooks → Edit, shown only when asked for, and can be replaced.
test('the signing secret of a webhook is revealed, copied and replaced in Settings', async ({ page }) => {
  const api = await signedIn('a');
  const name = `Signed ${Date.now()}`;
  const created = await api.post('/webhooks', {
    data: { name, url: 'https://example.com/hooks/ui', integrations: [{ id: channelOf('a') }] },
  });
  expect(created.status(), await created.text()).toBe(201);
  const { id } = await created.json();
  try {
    await page.goto('/settings');
    await page.getByRole('tab', { name: 'Webhooks', exact: true }).click();
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();

    await expect(page.getByText('Signing secret', { exact: true })).toBeVisible();
    await expect(page.getByText(/^whsec_[A-Za-z0-9_-]{43}$/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal' }).click();
    const shown = page.getByText(/^whsec_[A-Za-z0-9_-]{43}$/);
    await expect(shown).toBeVisible();
    const first = await shown.innerText();
    expect(first).toBe((await (await api.get(`/webhooks/${id}/secret`)).json()).secret);

    await page.getByRole('button', { name: 'Generate a new secret' }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(shown).not.toHaveText(first);
    expect(await shown.innerText()).toBe((await (await api.get(`/webhooks/${id}/secret`)).json()).secret);
  } finally {
    await api.delete(`/webhooks/${id}`);
    await api.dispose();
  }
});
