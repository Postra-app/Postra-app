import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'crypto';
import { anonymous } from '../helpers';
import { USERS } from '../seed';

// The consent screen ChatGPT and Claude send a person to (app #350). Access
// goes to the organisation selected in Postra, and the screen did not say
// which: on prod 10-08 the approval landed in an organisation with no
// channels and the assistant answered "you have no channels".

const consentUrl = async () => {
  const anon = await anonymous();
  const redirect = 'http://localhost:6274/oauth/callback';
  const res = await anon.post('/oauth/register', {
    data: { client_name: 'Claude', redirect_uris: [redirect], token_endpoint_auth_method: 'none' },
  });
  expect(res.status(), await res.text()).toBe(201);
  const { client_id } = await res.json();
  await anon.dispose();
  const challenge = createHash('sha256').update(randomBytes(32).toString('base64url')).digest('base64url');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id,
    redirect_uri: redirect,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: 'stack',
  });
  return `/oauth/authorize?${q}`;
};

test('the consent screen names the organisation the access goes to', async ({ page }) => {
  await page.goto(await consentUrl());
  await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('oauth-organisation')).toContainText(USERS.a.org);
});

test('with more than one organisation, the person picks which one', async ({ page }) => {
  const orgs = [
    { id: 'org-one', name: 'First Org' },
    { id: 'org-two', name: 'Second Org' },
  ];
  await page.route('**/api/user/organizations', (route) => route.fulfill({ json: orgs }));
  const changed: string[] = [];
  await page.route('**/api/user/change-org', async (route) => {
    changed.push(JSON.parse(route.request().postData() || '{}').id);
    await route.fulfill({ json: {} });
  });
  await page.goto(await consentUrl());
  await expect(page.getByRole('button', { name: 'Authorize' })).toBeVisible({ timeout: 20_000 });
  const select = page.getByLabel('Organisation');
  await expect(select.locator('option')).toHaveText(['First Org', 'Second Org']);
  await select.selectOption('org-two');
  await expect.poll(() => changed).toEqual(['org-two']);
});
