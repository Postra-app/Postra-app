import { APIRequestContext, expect, test } from '@playwright/test';
import { anonymous, database, throwawayOrg } from '../helpers';

// The channel-connect callback and the public page picker sit outside the
// session middleware, so they have to check sessions themselves.

const stateFor = async (api: APIRequestContext) => {
  const res = await api.get('/integrations/social/mastodon');
  expect(res.status(), await res.text()).toBe(200);
  return new URL((await res.json()).url).searchParams.get('state')!;
};

const connect = (api: APIRequestContext, state: string, code: string) =>
  api.post('/integrations/social-connect/mastodon', { data: { state, code, timezone: '0' } });

test('E2E-04-22: a session ended elsewhere cannot finish connecting a channel', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    const state = await stateFor(org.api);
    // "Sign out everywhere", a password change or a suspension bumps the
    // version; the browser still holds the old cookie. A valid signature was
    // all the callback asked for.
    const { userId } = await prisma.userOrganization.findFirstOrThrow({ where: { organizationId: org.orgId } });
    await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } });

    const res = await connect(org.api, state, `stale${Date.now()}`);
    expect([401, 403]).toContain(res.status());
    expect(await prisma.integration.count({ where: { organizationId: org.orgId } })).toBe(0);
  } finally {
    await prisma.integration.deleteMany({ where: { organizationId: org.orgId } });
    await org.remove();
    await prisma.$disconnect();
  }
});

test('E2E-04-23: the session-less page picker only finishes an invitee\'s own connection', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    // A state minted by a member: without an invitation behind it, the public
    // route must not pick a page for any channel of the organisation.
    const state = await stateFor(org.api);
    const stranger = await anonymous();
    const res = await stranger.post('/integrations/public/provider/00000000-0000-4000-8000-000000000000/connect', {
      data: { state, page: '1' },
    });
    expect(res.status()).toBe(403);
    await stranger.dispose();
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

test('E2E-08-31: a connect flow refuses a return address that is not a web address', async () => {
  // Stored with the flow and navigated to by whoever finished it:
  // `javascript:` ran script in a colleague's session.
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  try {
    for (const bad of ['javascript:alert(location.origin)//', 'data:text/html,x', '//attacker.example']) {
      const res = await org.api.get(`/integrations/social/mastodon?redirectUrl=${encodeURIComponent(bad)}`);
      expect(res.status(), bad).toBe(400);
    }
    for (const ok of ['postra://integrations', 'https://example.com/back', '/launches']) {
      const res = await org.api.get(`/integrations/social/mastodon?redirectUrl=${encodeURIComponent(ok)}`);
      expect(res.status(), ok).toBe(200);
    }
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});

// INT-12: two callbacks at once both saw the one free slot and both added
// a channel.
test('one free slot, two channels connected at once: only one is added', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 3, channels: 2 });
  try {
    const [one, two] = [await stateFor(org.api), await stateFor(org.api)];
    const tag = Date.now();
    const statuses = (
      await Promise.all([connect(org.api, one, `slotA${tag}`), connect(org.api, two, `slotB${tag}`)])
    ).map((r) => r.status());
    expect(statuses.filter((s) => s < 300)).toHaveLength(1);
    expect(
      await prisma.integration.count({ where: { organizationId: org.orgId, deletedAt: null, disabled: false } })
    ).toBe(3);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
