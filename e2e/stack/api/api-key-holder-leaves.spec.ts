import { expect, test } from '@playwright/test';
import { addMember, database, throwawayOrg } from '../helpers';

// E2E-11-362: owners and admins see the organisation's API key. Removing an
// admin, or making them a plain member, left the key they had copied working:
// the public API and MCP stayed open to someone who no longer belonged. The
// key is now replaced with the change, and the key the owner reads afterwards
// is the new one. A plain member never saw it, so removing one keeps it.

test('the API key is replaced when an admin is demoted or removed, not when a member is', async () => {
  test.setTimeout(90_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const admin = await addMember(prisma, org.orgId, 'ADMIN');
  const second = await addMember(prisma, org.orgId, 'ADMIN');
  const member = await addMember(prisma, org.orgId, 'USER');
  try {
    const key = async () => (await (await org.api.get('/user/self')).json()).publicApi as string;
    const works = async (k: string) =>
      (await org.api.get('/public/v1/integrations', { headers: { Authorization: k } })).status();

    const first = await key();
    expect(await works(first)).toBe(200);

    const removeMember = await org.api.delete(`/settings/team/${member.userId}`);
    expect(removeMember.status(), await removeMember.text()).toBe(200);
    expect((await removeMember.json()).keyReplaced).toBe(false);
    expect(await key()).toBe(first);

    const demote = await org.api.put(`/settings/team/${admin.userId}/role`, { data: { role: 'USER' } });
    expect(demote.status(), await demote.text()).toBe(200);
    expect((await demote.json()).keyReplaced).toBe(true);
    const afterDemote = await key();
    expect(afterDemote).not.toBe(first);
    expect(await works(first)).toBe(401);
    expect(await works(afterDemote)).toBe(200);

    const remove = await org.api.delete(`/settings/team/${second.userId}`);
    expect(remove.status(), await remove.text()).toBe(200);
    expect((await remove.json()).keyReplaced).toBe(true);
    expect(await works(afterDemote)).toBe(401);
    expect(await works(await key())).toBe(200);

    const audit = await prisma.auditLog.findMany({
      where: { organizationId: org.orgId, action: 'security.apikey.rotate' },
    });
    expect(audit.map((a) => (a.metadata as any).reason).sort()).toEqual([
      'admin-demoted',
      'admin-removed',
    ]);
  } finally {
    await member.remove();
    await second.remove();
    await admin.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});
