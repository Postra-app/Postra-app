import { expect, test } from '@playwright/test';
import { anonymous, signedIn } from '../helpers';

// "Report a problem" goes to Sentry from the browser and to the team's inbox
// through this route (users.controller /user/problem-report).

test('a signed-in user can send a problem report', async () => {
  const api = await signedIn('a');
  const res = await api.post('/user/problem-report', {
    data: { message: '[stack] the button did nothing', name: 'Stack', page: '/billing', eventId: 'a'.repeat(32) },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
  expect(await res.json()).toEqual({ ok: true });
  await api.dispose();
});

test('a report without text, or with a forged event id, is 400', async () => {
  const api = await signedIn('a');
  expect((await api.post('/user/problem-report', { data: { message: '' } })).status()).toBe(400);
  expect((await api.post('/user/problem-report', { data: { message: 'x', eventId: '<script>' } })).status()).toBe(400);
  expect((await api.post('/user/problem-report', { data: { message: 'x', email: 'not-an-email' } })).status()).toBe(400);
  await api.dispose();
});

test('nobody can send a report without a session', async () => {
  const api = await anonymous();
  expect((await api.post('/user/problem-report', { data: { message: 'x' } })).status()).toBe(401);
  await api.dispose();
});
