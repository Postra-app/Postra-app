import { expect, test } from '@playwright/test';

// Remove the 2026-10-04 test feed (3aa2611b) from the E2E account.
test('delete the test Auto Post feed', async ({ request }) => {
  const login = await request.post('/api/auth/login', {
    data: { email: process.env.E2E_EMAIL, password: process.env.E2E_PASSWORD, provider: 'LOCAL' },
  });
  expect(login.status()).toBe(200);
  const id = '3aa2611b-568b-427b-918f-c617b6f2a0d3';
  const before = (await (await request.get('/api/autopost')).json()) as { id: string }[];
  console.log('feed listed before:', before.some((f) => f.id === id));
  const del = await request.delete(`/api/autopost/${id}`);
  console.log('DELETE', del.status());
  const after = (await (await request.get('/api/autopost')).json()) as { id: string }[];
  console.log('feed listed after:', after.some((f) => f.id === id));
  expect(after.some((f) => f.id === id)).toBe(false);
});
