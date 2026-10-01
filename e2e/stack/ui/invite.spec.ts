import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';
import { USERS } from '../seed';

// The client's side of an invite link, in a browser with no Postra session:
// the page names who is inviting, "Continue" goes to the platform, and the
// platform's redirect back ends in "Channel Connected" — not in 401.

test.use({ storageState: { cookies: [], origins: [] } });

test('a client without an account connects a channel from an invite link', async ({
  page,
}) => {
  const a = await signedIn('a');
  const { url } = await (await a.get('/integrations/social/mastodon?invite=true')).json();
  const invitePath = new URL(url).pathname;

  await page.goto(invitePath);
  await expect(
    page.getByRole('heading', { name: `${USERS.a.org} invited you to connect Mastodon` })
  ).toBeVisible();
  // Through our backend (which marks this browser) on to the platform's
  // consent screen — the end of our part. Take the state it was given and
  // come back the way the platform would.
  await page.getByRole('button', { name: 'Continue to Mastodon' }).click();
  await page.waitForURL(/localhost:58080\/oauth\/authorize/);
  const state = new URL(page.url()).searchParams.get('state');
  expect(state).toBeTruthy();

  await page.goto(`/integrations/social/mastodon?code=uiinvitee&state=${state}`);
  await expect(page.getByText('Channel Connected!')).toBeVisible();

  const list = (await (await a.get('/integrations/list')).json()).integrations as {
    id: string;
    name: string;
  }[];
  const added = list.find((c) => c.name === 'Invited uiinvitee');
  expect(added, 'the channel is in the inviting organisation').toBeTruthy();
  await a.delete('/integrations', { data: { id: added!.id } });
  await a.dispose();
});
