import { expect, test } from '@playwright/test';
import { anonymous, signedIn } from '../helpers';

// The Postra admin panel is for Postra staff (User.isSuperAdmin), not for the
// owner of an organisation — the seeded users are owners. Every admin route
// must refuse them with 403 (E2E-09-63: was 400 "Unauthorized") and without a
// session with 401.

const UNKNOWN = '00000000-0000-4000-8000-000000000000';

const ADMIN_READS = [
  '/admin/stats',
  '/admin/users',
  '/admin/audit',
  '/admin/integrations',
  `/admin/problem-reports/${UNKNOWN}.png`,
  '/announcements/list',
  `/user/impersonate?name=owner`,
];

test('an organisation owner is refused every admin read with 403', async () => {
  const api = await signedIn('a');
  for (const path of ADMIN_READS) {
    expect((await api.get(path)).status(), path).toBe(403);
  }
  await api.dispose();
});

test('an organisation owner cannot announce, delete announcements or grant plans', async () => {
  const api = await signedIn('a');
  expect(
    (
      await api.post('/announcements', {
        data: { title: 'Stack test', description: 'Must not be posted', color: 'INFO' },
      })
    ).status()
  ).toBe(403);
  expect((await api.delete(`/announcements/${UNKNOWN}`)).status()).toBe(403);
  expect((await api.post('/admin/suspend-user', { data: { userId: UNKNOWN, value: true } })).status()).toBe(403);
  expect(
    (
      await api.post('/billing/add-subscription', {
        data: { subscription: 'PRO' },
      })
    ).status()
  ).toBe(403);
  await api.dispose();
});

test('admin routes without a session are 401', async () => {
  const api = await anonymous();
  for (const path of ADMIN_READS) {
    expect((await api.get(path)).status(), path).toBe(401);
  }
  await api.dispose();
});
