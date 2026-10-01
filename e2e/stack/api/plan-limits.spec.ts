import { expect, test } from '@playwright/test';
import { signedIn } from '../helpers';

// What a plan pays for (pricing.ts allowedProviders). Organisation A is on
// Pro, B on Starter; billing is on in the stack like in production.

const connect = (platform: string) => `/integrations/social/${platform}`;

test('Starter cannot connect Pro or Business platforms', async () => {
  const starter = await signedIn('b');
  for (const platform of ['youtube', 'threads', 'linkedin-page', 'x', 'discord']) {
    expect((await starter.get(connect(platform))).status(), platform).toBe(402);
  }
  await starter.dispose();
});

test('Starter can start connecting its own platforms', async () => {
  const starter = await signedIn('b');
  for (const platform of ['mastodon', 'linkedin', 'telegram']) {
    expect((await starter.get(connect(platform))).status(), platform).not.toBe(402);
  }
  await starter.dispose();
});

test('Pro gets YouTube and Threads but not X or Discord', async () => {
  const pro = await signedIn('a');
  for (const platform of ['youtube', 'threads']) {
    expect((await pro.get(connect(platform))).status(), platform).not.toBe(402);
  }
  for (const platform of ['x', 'discord']) {
    expect((await pro.get(connect(platform))).status(), platform).toBe(402);
  }
  await pro.dispose();
});

test('an unknown platform is 400, and reconnecting a channel you lack is 404', async () => {
  const pro = await signedIn('a');
  expect((await pro.get(connect('not-a-platform'))).status()).toBe(400);
  expect((await pro.get(`${connect('youtube')}?refresh=not-my-channel`)).status()).toBe(404);
  await pro.dispose();
});
