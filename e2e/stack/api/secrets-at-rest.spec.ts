import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';
import { AuthService, encrypt_legacy_using_IV } from '@gitroom/helpers/auth/auth.service';
import { SecretsUpgradeService } from '@gitroom/nestjs-libraries/database/prisma/secrets/secrets-upgrade.service';

// Secrets at rest (E2E-11-108): rows written before 2026-10-30 hold the
// fixed-IV cipher under JWT_SECRET. They keep working until the backend's
// upgrade rewrites them (enc2:: for what is read back, sha256: for what is
// only compared), and the same API key, OAuth token and channel token work
// after it. The backend runs the upgrade at start; here it runs on this
// test's organisation only, with the stack's keys.

const publicApi = (token: string) =>
  request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: token },
  });

test('legacy secrets work before and after the upgrade, and are stored in the new form', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 2 });
  try {
    // As production stored them: the API key handed out was the legacy
    // ciphertext itself; channel tokens enc:: + that cipher; OAuth secrets,
    // codes and tokens the bare cipher.
    const legacyKey = encrypt_legacy_using_IV(`legacy-key-${owner.orgId}`);
    await prisma.organization.update({
      where: { id: owner.orgId },
      data: { apiKey: legacyKey, apiKeyHash: null },
    });
    const channelId = owner.channelIds[0];
    await prisma.integration.update({
      where: { id: channelId },
      data: {
        token: 'enc::' + encrypt_legacy_using_IV('channel-token'),
        refreshToken: 'enc::' + encrypt_legacy_using_IV('channel-refresh'),
        customInstanceDetails: encrypt_legacy_using_IV('{"service":"https://bsky.social"}'),
      },
    });
    // A Skool account connected before the at-rest format: its cookies in a
    // signed JWT, which SkoolProvider still reads.
    const skoolId = owner.channelIds[1];
    await prisma.integration.update({
      where: { id: skoolId },
      data: {
        token: 'enc::' + encrypt_legacy_using_IV('skool-token'),
        customInstanceDetails: AuthService.signJWT({ client_id: 'c-1', auth_token: 't-1' }),
      },
    });
    const app = await prisma.oAuthApp.create({
      data: {
        organizationId: owner.orgId,
        name: 'Legacy app',
        redirectUrl: 'https://example.com/callback',
        clientId: `pca_legacy_${owner.orgId}`,
        clientSecret: encrypt_legacy_using_IV('pcs_legacy'),
      },
    });
    const oauthToken = `pos_legacy_${owner.orgId}`;
    await prisma.oAuthAuthorization.create({
      data: {
        oauthAppId: app.id,
        userId: owner.userId,
        organizationId: owner.orgId,
        accessToken: encrypt_legacy_using_IV(oauthToken),
      },
    });

    const byKey = await publicApi(legacyKey);
    const byToken = await publicApi(oauthToken);
    expect((await byKey.get('integrations')).status()).toBe(200);
    expect((await byToken.get('integrations')).status()).toBe(200);

    const result = await new SecretsUpgradeService(prisma as never).run(owner.orgId);
    expect(result.organizations.failed + result.integrations.failed).toBe(0);
    expect(result.oauthApps.failed + result.oauthAuthorizations.failed).toBe(0);

    const org = await prisma.organization.findUniqueOrThrow({ where: { id: owner.orgId } });
    expect(org.apiKey).toMatch(/^enc2::k1:/);
    expect(org.apiKeyHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const channel = await prisma.integration.findUniqueOrThrow({ where: { id: channelId } });
    expect(channel.token).toMatch(/^enc2::k1:/);
    expect(channel.refreshToken).toMatch(/^enc2::k1:/);
    expect(channel.customInstanceDetails).toMatch(/^enc2::k1:/);
    const skool = await prisma.integration.findUniqueOrThrow({ where: { id: skoolId } });
    expect(skool.token).toMatch(/^enc2::k1:/);
    expect(JSON.parse(AuthService.decryptSecret(skool.customInstanceDetails!))).toEqual({
      client_id: 'c-1',
      auth_token: 't-1',
    });
    const grant = await prisma.oAuthAuthorization.findFirstOrThrow({ where: { oauthAppId: app.id } });
    expect(grant.accessToken).toMatch(/^sha256:/);
    expect((await prisma.oAuthApp.findUniqueOrThrow({ where: { id: app.id } })).clientSecret).toMatch(
      /^sha256:/
    );

    // Same credentials, new storage.
    expect((await byKey.get('integrations')).status()).toBe(200);
    expect((await byToken.get('integrations')).status()).toBe(200);
    // The admin is shown the key they have been using.
    const self = await owner.api.get('/user/self');
    expect((await self.json()).publicApi).toBe(legacyKey);
    // The stored ciphertext is not a key.
    const withCiphertext = await publicApi(org.apiKey!);
    expect((await withCiphertext.get('integrations')).status()).toBe(401);
    await Promise.all([byKey.dispose(), byToken.dispose(), withCiphertext.dispose()]);

    // A second run finds nothing left and leaves the rows as they are.
    const again = await new SecretsUpgradeService(prisma as never).run(owner.orgId);
    expect(Object.values(again).every((r) => r.found === 0)).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: owner.orgId } })).apiKey).toBe(
      org.apiKey
    );
    expect((await prisma.integration.findUniqueOrThrow({ where: { id: channelId } })).token).toBe(
      channel.token
    );
  } finally {
    await prisma.oAuthApp.deleteMany({ where: { organizationId: owner.orgId } });
    await owner.remove();
    await prisma.$disconnect();
  }
});

test('a rotated API key is stored encrypted and hashed, and only the new key works', async () => {
  const prisma = database();
  const owner = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  try {
    const before = (await (await owner.api.get('/user/self')).json()).publicApi as string;
    const rotated = await owner.api.post('/user/api-key/rotate');
    expect(rotated.status(), await rotated.text()).toBeLessThan(300);
    const key = (await (await owner.api.get('/user/self')).json()).publicApi as string;
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: owner.orgId } });
    expect(org.apiKey).toMatch(/^enc2::/);
    expect(org.apiKey).not.toContain(key);
    expect(org.apiKeyHash).toMatch(/^sha256:/);

    const api = await publicApi(key);
    expect((await api.get('integrations')).status()).toBe(200);
    await api.dispose();
    const old = await publicApi(before);
    expect((await old.get('integrations')).status()).toBe(401);
    await old.dispose();
  } finally {
    await owner.remove();
    await prisma.$disconnect();
  }
});
