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

test('a report can carry the widget screenshot (a ~1 MB PNG passes the body limit)', async () => {
  const api = await signedIn('a');
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(1024 * 1024)]);
  const res = await api.post('/user/problem-report', {
    data: { message: '[stack] with screenshot', screenshot: `data:image/png;base64,${png.toString('base64')}` },
  });
  expect(res.status(), await res.text()).toBeLessThan(300);
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
