import { expect, request as pwRequest, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// A sign-in is written to the audit trail with the person who signed in. The
// login route runs before there is a session, so the row had no user: the
// admin audit view showed sign-ins by nobody, and "who signed in today" could
// not be counted.
let prisma: PrismaClient;
test.beforeAll(() => {
  prisma = database();
});
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('a password sign-in is audited with the user who signed in', async () => {
  const org = await throwawayOrg(prisma, { tier: 'STANDARD', totalChannels: 3, channels: 0 });
  try {
    const user = await prisma.user.findFirstOrThrow({
      where: { organizations: { some: { organizationId: org.orgId } } },
    });
    const api = await pwRequest.newContext({
      baseURL: BACKEND_URL,
      extraHTTPHeaders: { 'x-forwarded-for': `198.19.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}` },
    });
    const since = new Date();
    const res = await api.post('/auth/login', { data: { email: user.email, password: 'Stack-tests-T-1', provider: 'LOCAL' } });
    expect(res.status(), await res.text()).toBe(200);
    await expect
      .poll(async () =>
        (await prisma.auditLog.findFirst({
          where: { action: 'auth.login', createdAt: { gte: since }, metadata: { path: ['email'], equals: user.email } },
          select: { userId: true },
        }))?.userId
      )
      .toBe(user.id);
    await api.dispose();
  } finally {
    await org.remove();
  }
});
