import { expect, test } from '@playwright/test';
import { addMember, database, throwawayOrg } from '../helpers';

// E2E-11-85: roles were fixed at invitation. Making a member an admin meant
// removing and inviting them again, and an owner could never hand the
// organisation over, while the error for removing the last owner told them
// to "make someone else the owner first". The owner now changes roles in
// Settings → Team and can hand ownership to a member, staying on as an admin.
// Each test has its own organisation: they change roles.

const team = async (api: Awaited<ReturnType<typeof throwawayOrg>>['api']) =>
  ((await (await api.get('/settings/team')).json()).users as Array<{
    role: string;
    disabled: boolean;
    user: { id: string };
  }>);

test('the owner makes a member an admin and back, at once', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  try {
    expect((await member.api.get('/settings/team')).status()).toBe(403);

    const up = await org.api.put(`/settings/team/${member.userId}/role`, {
      data: { role: 'ADMIN' },
    });
    expect(up.status(), await up.text()).toBe(200);
    // No wait for the 30s auth cache: the new role applies to the next call.
    expect((await member.api.get('/settings/team')).status()).toBe(200);
    expect((await member.api.get('/user/self')).ok()).toBe(true);

    const down = await org.api.put(`/settings/team/${member.userId}/role`, {
      data: { role: 'USER' },
    });
    expect(down.status()).toBe(200);
    expect((await member.api.get('/settings/team')).status()).toBe(403);

    const audit = await prisma.auditLog.findMany({
      where: { organizationId: org.orgId, action: 'team.role.change' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => (a.metadata as any).to)).toEqual(['ADMIN', 'USER']);
    expect(audit.every((a) => a.userId === org.userId)).toBe(true);
  } finally {
    await member.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});

test('only the owner changes roles, never their own, and only to user or admin', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const admin = await addMember(prisma, org.orgId, 'ADMIN');
  const member = await addMember(prisma, org.orgId, 'USER');
  try {
    // An admin manages the team (invite, remove) but does not hand out roles.
    const byAdmin = await admin.api.put(`/settings/team/${member.userId}/role`, {
      data: { role: 'ADMIN' },
    });
    expect(byAdmin.status()).toBe(403);
    expect(
      (await admin.api.post(`/settings/transfer-ownership/${member.userId}`)).status()
    ).toBe(403);
    expect(
      (await member.api.put(`/settings/team/${member.userId}/role`, { data: { role: 'ADMIN' } })).status()
    ).toBe(403);

    expect(
      (await org.api.put(`/settings/team/${org.userId}/role`, { data: { role: 'USER' } })).status()
    ).toBe(400);
    // Ownership has its own route.
    expect(
      (await org.api.put(`/settings/team/${member.userId}/role`, { data: { role: 'SUPERADMIN' } })).status()
    ).toBe(400);
    expect(
      (
        await org.api.put('/settings/team/00000000-0000-4000-8000-000000000000/role', {
          data: { role: 'ADMIN' },
        })
      ).status()
    ).toBe(404);
    const roles = Object.fromEntries((await team(org.api)).map((m) => [m.user.id, m.role]));
    expect(roles[member.userId]).toBe('USER');
    expect(roles[admin.userId]).toBe('ADMIN');
  } finally {
    await admin.remove();
    await member.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});

test('the owner hands the organisation over and stays on as an admin', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const member = await addMember(prisma, org.orgId, 'USER');
  try {
    // Before: the owner cannot leave, and the message names the way out.
    const leave = await org.api.delete(`/settings/team/${org.userId}`);
    expect(leave.status()).toBe(400);
    expect((await leave.json()).message).toContain('Make owner');

    const transfer = await org.api.post(`/settings/transfer-ownership/${member.userId}`);
    expect(transfer.ok(), await transfer.text()).toBe(true);

    const roles = Object.fromEntries((await team(member.api)).map((m) => [m.user.id, m.role]));
    expect(roles).toEqual({ [member.userId]: 'SUPERADMIN', [org.userId]: 'ADMIN' });
    // The new owner holds the owner's powers at once, the old one does not.
    expect(
      (await org.api.put(`/settings/team/${member.userId}/role`, { data: { role: 'USER' } })).status()
    ).toBe(403);
    expect((await member.api.get('/user/self')).ok()).toBe(true);
    // And the former owner can now be removed (or leave).
    expect((await member.api.delete(`/settings/team/${org.userId}`)).status()).toBe(200);

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.orgId, action: 'team.owner.transfer' },
    });
    expect(audit?.userId).toBe(org.userId);
    expect((audit?.metadata as any)?.targetUserId).toBe(member.userId);
  } finally {
    await member.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});

test('ownership never goes to a turned-off seat or a suspended account', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'ULTIMATE', totalChannels: 5, channels: 0 });
  const seatOff = await addMember(prisma, org.orgId, 'ADMIN');
  const suspended = await addMember(prisma, org.orgId, 'USER');
  try {
    await prisma.userOrganization.update({
      where: { userId_organizationId: { userId: seatOff.userId, organizationId: org.orgId } },
      data: { disabled: true },
    });
    await prisma.user.update({ where: { id: suspended.userId }, data: { suspendedAt: new Date() } });

    for (const who of [seatOff, suspended]) {
      const res = await org.api.post(`/settings/transfer-ownership/${who.userId}`);
      expect(res.status()).toBe(400);
    }
    const team1 = await team(org.api);
    expect(team1.find((m) => m.user.id === org.userId)?.role).toBe('SUPERADMIN');
    // The seat counter reads this field; it was missing, so turned-off seats
    // counted as used.
    expect(team1.find((m) => m.user.id === seatOff.userId)?.disabled).toBe(true);
  } finally {
    await seatOff.remove();
    await suspended.remove();
    await org.remove();
    await prisma.$disconnect();
  }
});
