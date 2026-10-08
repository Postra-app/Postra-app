import { expect, test as setup } from '@playwright/test';
import { existsSync, statSync } from 'fs';

// Account 3 signed into its own organisation (E2E Retest Co), cached for an
// hour: sign-in is capped at 5 per 15 minutes per IP.
export const PROOF_STATE = `${__dirname}/.auth/proof-c.json`;

setup('session for account 3', async ({ request }) => {
  if (existsSync(PROOF_STATE) && Date.now() - statSync(PROOF_STATE).mtimeMs < 3_600_000) return;
  const login = await request.post('/api/auth/login', {
    data: { email: process.env.E2E_EMAIL_3, password: process.env.E2E_PASSWORD_3, provider: 'LOCAL' },
  });
  expect(login.status(), 'login').toBe(200);
  const orgs: { id: string; name: string }[] = await (await request.get('/api/user/organizations')).json();
  const own = orgs.find((o) => o.name === 'E2E Retest Co');
  expect(own, 'E2E Retest Co').toBeTruthy();
  expect((await request.post('/api/user/change-org', { data: { id: own!.id } })).ok()).toBeTruthy();
  await request.storageState({ path: PROOF_STATE });
});
