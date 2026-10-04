// Seeds the users the load test signs in as: one organisation each (per-org
// rate limits, like real customers), Pro, one channel, signed in once. Writes
// their session tokens to users.json for k6. Never production: it writes
// straight into the database it is pointed at.
//
//   DATABASE_URL=… BACKEND_URL=http://localhost:53000 node e2e/load/seed.mjs 200
//   node e2e/load/seed.mjs --remove     (deletes every organisation it made)
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { writeFileSync } from 'node:fs';

const BACKEND = process.env.BACKEND_URL || 'http://localhost:53000';
const PREFIX = 'Load test ';
const prisma = new PrismaClient();

if (/app\.postra\.pl|app\.postra\.co\.uk/.test(BACKEND)) {
  throw new Error('Not against production.');
}

if (process.argv[2] === '--remove') {
  const orgs = await prisma.organization.findMany({
    where: { name: { startsWith: PREFIX } },
    select: { id: true, users: { select: { userId: true } } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
  await prisma.user.deleteMany({
    where: { id: { in: orgs.flatMap((o) => o.users.map((u) => u.userId)) } },
  });
  console.log(`removed ${orgs.length} organisations`);
  await prisma.$disconnect();
  process.exit(0);
}

const count = Number(process.argv[2] || 50);
const password = 'Load-test-T-1';
const hash = bcrypt.hashSync(password, 10);
const run = Date.now();
const users = [];

for (let i = 0; i < count; i++) {
  const tag = `${run}-${i}`;
  const email = `load-${tag}@example.com`;
  const org = await prisma.organization.create({
    data: { name: `${PREFIX}${tag}`, apiKey: `load-${tag}`, isTrailing: false },
  });
  const user = await prisma.user.create({
    data: {
      email,
      password: hash,
      providerName: 'LOCAL',
      name: 'Load',
      lastName: 'Test',
      timezone: 0,
      activated: true,
      createdAt: new Date(Date.now() - 2 * 86_400_000),
    },
  });
  await prisma.userOrganization.create({
    data: { userId: user.id, organizationId: org.id, role: 'SUPERADMIN' },
  });
  await prisma.subscription.create({
    data: {
      organizationId: org.id,
      subscriptionTier: 'PRO',
      period: 'MONTHLY',
      totalChannels: 6,
      isLifetime: false,
    },
  });
  const channel = await prisma.integration.create({
    data: {
      id: `load-${tag}`,
      internalId: `load-${tag}-internal`,
      organizationId: org.id,
      name: `Load channel ${i}`,
      providerIdentifier: 'bluesky',
      type: 'social',
      token: 'fake-token',
      profile: `load-${tag}`,
    },
  });
  // Sign-in allows 5 attempts per address and window; each user signs in
  // from its own (the stack trusts X-Forwarded-For, as the ALB does).
  const res = await fetch(`${BACKEND}/auth/login`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `198.18.${Math.floor(i / 250)}.${(i % 250) + 1}`,
    },
    body: JSON.stringify({ email, password, provider: 'LOCAL' }),
  });
  const auth = res.headers.get('auth') || /auth=([^;]+)/.exec(res.headers.get('set-cookie') || '')?.[1];
  if (!res.ok || !auth) throw new Error(`sign-in ${email}: ${res.status} ${await res.text()}`);
  users.push({ auth, channel: channel.id });
}

writeFileSync(new URL('./users.json', import.meta.url), JSON.stringify(users));
console.log(`seeded ${users.length} users → e2e/load/users.json`);
await prisma.$disconnect();
