import { APIRequestContext, expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// A trial cannot take a channel that was already connected to another Postra
// organisation (a second trial on the same account): the callback answers 412
// and the app offers to end the trial with a payment ("Fast-forward — charge
// me now", PreConditionComponent). A paying organisation connects it as usual.

const stateFor = async (api: APIRequestContext) => {
  const res = await api.get('/integrations/social/mastodon');
  expect(res.status(), await res.text()).toBe(200);
  return new URL((await res.json()).url).searchParams.get('state')!;
};

const connect = (api: APIRequestContext, state: string, code: string) =>
  api.post('/integrations/social-connect/mastodon', {
    data: { state, code, timezone: '0' },
  });

test('a trial cannot connect a channel another organisation had; a paying one can', async () => {
  const prisma = database();
  const earlier = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const trial = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const paying = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  // The fake Mastodon names the account after the code.
  const code = `reuse${Date.now()}`;
  try {
    await prisma.integration.create({
      data: {
        id: `stack-earlier-${code}`,
        internalId: `acct-${code}`,
        rootInternalId: `acct-${code}`,
        organizationId: earlier.orgId,
        name: 'Connected earlier',
        providerIdentifier: 'mastodon',
        type: 'social',
        token: 'fake-token',
        profile: code,
        deletedAt: new Date(),
      },
    });

    // The state is minted on Pro; the trial flag is what the callback checks.
    const trialState = await stateFor(trial.api);
    await prisma.organization.update({ where: { id: trial.orgId }, data: { isTrailing: true } });
    expect((await connect(trial.api, trialState, code)).status()).toBe(412);
    expect(await prisma.integration.count({ where: { organizationId: trial.orgId } })).toBe(0);

    const payingState = await stateFor(paying.api);
    const res = await connect(paying.api, payingState, code);
    expect(res.status(), await res.text()).toBe(201);
    expect(
      await prisma.integration.count({ where: { organizationId: paying.orgId, deletedAt: null } })
    ).toBe(1);
  } finally {
    await prisma.integration.deleteMany({
      where: { organizationId: { in: [earlier.orgId, trial.orgId, paying.orgId] } },
    });
    await earlier.remove();
    await trial.remove();
    await paying.remove();
    await prisma.$disconnect();
  }
});
