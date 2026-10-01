import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcrypt';
import Redis from 'ioredis';

// Two organisations that must never see each other's data. Every value is a
// local fake (example.com addresses, fake tokens).
export const USERS = {
  a: {
    email: 'owner-a@example.com',
    password: 'Stack-tests-A-1',
    org: 'Stack Org A',
    apiKey: 'stack-api-key-a',
    channel: { id: 'stack-channel-a', name: 'Stack Bluesky A' },
    // Publishes for real — to e2e/stack/fake-mastodon.mjs.
    mastodon: { id: 'stack-mastodon-a', name: 'Stack Mastodon A' },
  },
  b: {
    email: 'owner-b@example.com',
    password: 'Stack-tests-B-1',
    org: 'Stack Org B',
    apiKey: 'stack-api-key-b',
    channel: { id: 'stack-channel-b', name: 'Stack Bluesky B' },
  },
} as const;

// A plain member (role USER) of organisation A: can work, cannot manage the
// team, billing or the API key.
export const MEMBER = {
  email: 'member-a@example.com',
  password: 'Stack-tests-M-1',
} as const;

export type UserKey = keyof typeof USERS | 'member';

const refuse = (url: string) => {
  throw new Error(
    `refusing to wipe ${url.replace(/:[^:@]*@/, ':***@')} — the stack tests only ever reset the stores from e2e/stack/docker-compose.yml`
  );
};

// Empties every application table and Redis (sessions, caches and the login
// throttle, which outlives a backend restart), then seeds both organisations.
// Runs once per test run, against the throwaway stores only.
export const resetAndSeed = async (databaseUrl: string, redisUrl: string) => {
  if (!/@localhost:55432\//.test(databaseUrl)) refuse(databaseUrl);
  if (!/^redis:\/\/localhost:56379\/?$/.test(redisUrl)) refuse(redisUrl);

  const redis = new Redis(redisUrl);
  await redis.flushall();
  redis.disconnect();

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const tables: { tablename: string }[] = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(
      `TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`
    );

    for (const user of Object.values(USERS)) {
      const org = await prisma.organization.create({
        data: { name: user.org, apiKey: user.apiKey },
      });
      const created = await prisma.user.create({
        data: {
          email: user.email,
          password: hashSync(user.password, 10),
          providerName: 'LOCAL',
          name: 'Stack',
          lastName: 'Tester',
          timezone: 0,
          activated: true,
        },
      });
      await prisma.userOrganization.create({
        data: { userId: created.id, organizationId: org.id, role: 'SUPERADMIN' },
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
      await prisma.integration.create({
        data: {
          id: user.channel.id,
          internalId: `${user.channel.id}-internal`,
          organizationId: org.id,
          name: user.channel.name,
          providerIdentifier: 'bluesky',
          type: 'social',
          token: 'fake-token',
          profile: user.channel.id,
        },
      });
    }

    const orgOfA = await prisma.organization.findFirstOrThrow({
      where: { name: USERS.a.org },
    });
    const member = await prisma.user.create({
      data: {
        email: MEMBER.email,
        password: hashSync(MEMBER.password, 10),
        providerName: 'LOCAL',
        name: 'Stack',
        lastName: 'Member',
        timezone: 0,
        activated: true,
      },
    });
    await prisma.userOrganization.create({
      data: { userId: member.id, organizationId: orgOfA.id, role: 'USER' },
    });

    const { mastodon } = USERS.a;
    const orgA = await prisma.organization.findFirstOrThrow({
      where: { name: USERS.a.org },
    });
    await prisma.integration.create({
      data: {
        id: mastodon.id,
        internalId: `${mastodon.id}-internal`,
        organizationId: orgA.id,
        name: mastodon.name,
        providerIdentifier: 'mastodon',
        type: 'social',
        token: 'stack-mastodon-token',
        profile: 'stack',
      },
    });
  } finally {
    await prisma.$disconnect();
  }
};
