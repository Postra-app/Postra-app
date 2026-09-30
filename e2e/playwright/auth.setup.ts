import { expect, test as setup } from '@playwright/test';
import { env, STATE_FILE } from './env';

// Sign in once through the API and hand the cookies to every test. Going
// through the form each time would burn the 5-per-15-minutes login limit.
setup('sign in', async ({ request, baseURL }) => {
  const login = await request.post('/api/auth/login', {
    data: {
      email: env('E2E_EMAIL'),
      password: env('E2E_PASSWORD'),
      provider: 'LOCAL',
    },
  });
  expect(login.status(), 'login').toBe(200);

  // An account in several organisations lands in whichever the backend picks
  // first; E2E_ORG pins the one the tests should use.
  const orgName = process.env.E2E_ORG;
  if (orgName) {
    const orgs: { id: string; name: string }[] = await (
      await request.get('/api/user/organizations')
    ).json();
    const org = orgs.find((o) => o.name === orgName);
    expect(org, `organisation "${orgName}"`).toBeTruthy();
    const change = await request.post('/api/user/change-org', {
      data: { id: org!.id },
    });
    expect(change.ok(), 'change-org').toBeTruthy();
  }

  await request.storageState({ path: STATE_FILE });
  expect(baseURL).toBeTruthy();
});
