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
    tier: 'PRO',
    channels: 6,
    channel: { id: 'stack-channel-a', name: 'Stack Bluesky A' },
    // Publishes for real — to e2e/stack/fake-mastodon.mjs.
    mastodon: { id: 'stack-mastodon-a', name: 'Stack Mastodon A' },
    // A bot channel, for the bot nickname dialog. Never published to.
    discord: { id: 'stack-discord-a', name: 'Stack Discord A' },
  },
  b: {
    email: 'owner-b@example.com',
    password: 'Stack-tests-B-1',
    org: 'Stack Org B',
    apiKey: 'stack-api-key-b',
    // Starter: the cheapest paid plan, the one with the most plan gates.
    tier: 'STANDARD',
    channels: 3,
    channel: { id: 'stack-channel-b', name: 'Stack Bluesky B' },
  },
} as const;

// A plain member (role USER) of organisation A: can work, cannot manage the
// team, billing or the API key.
export const MEMBER = {
  email: 'member-a@example.com',
  password: 'Stack-tests-M-1',
} as const;

// A Business (ULTIMATE) agency with every seat taken: the owner, one ADMIN
// and three USERs (team_members = 5 including the owner). `leaver` is the one
// team-seats.spec.ts removes; nothing else may rely on them.
export const ORG_C = {
  org: 'Stack Org C',
  apiKey: 'stack-api-key-c',
  tier: 'ULTIMATE',
  channels: 12,
  channel: { id: 'stack-channel-c', name: 'Stack Bluesky C' },
  owner: { email: 'owner-c@example.com', password: 'Stack-tests-C-1' },
  admin: { email: 'admin-c@example.com', password: 'Stack-tests-C-2' },
  user: { email: 'user-c@example.com', password: 'Stack-tests-C-3' },
  other: { email: 'other-c@example.com', password: 'Stack-tests-C-4' },
  leaver: { email: 'leaver-c@example.com', password: 'Stack-tests-C-5' },
} as const;

export type UserKey =
  | keyof typeof USERS
  | 'member'
  | 'c-owner'
  | 'c-admin'
  | 'c-user'
  | 'c-leaver';

// Every seeded account that global-setup signs in once.
export const ACCOUNTS: [UserKey, { email: string; password: string }][] = [
  ['a', USERS.a],
  ['b', USERS.b],
  ['member', MEMBER],
  ['c-owner', ORG_C.owner],
  ['c-admin', ORG_C.admin],
  ['c-user', ORG_C.user],
  ['c-leaver', ORG_C.leaver],
];

const refuse = (url: string) => {
  throw new Error(
    `refusing to wipe ${url.replace(/:[^:@]*@/, ':***@')} - the stack tests only ever reset the stores from e2e/stack/docker-compose.yml`
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
          // AI is locked for an hour after sign-up (AccountAgeGuard); the
          // owners are old accounts, the member stays brand new.
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
      await prisma.userOrganization.create({
        data: { userId: created.id, organizationId: org.id, role: 'SUPERADMIN' },
      });
      await prisma.subscription.create({
        data: {
          organizationId: org.id,
          subscriptionTier: user.tier,
          period: 'MONTHLY',
          totalChannels: user.channels,
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

    await prisma.integration.create({
      data: {
        id: USERS.a.discord.id,
        internalId: `${USERS.a.discord.id}-internal`,
        organizationId: orgOfA.id,
        name: USERS.a.discord.name,
        providerIdentifier: 'discord',
        type: 'social',
        token: 'stack-discord-token',
        profile: 'stack-discord',
      },
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

    const orgC = await prisma.organization.create({
      data: { name: ORG_C.org, apiKey: ORG_C.apiKey },
    });
    await prisma.subscription.create({
      data: {
        organizationId: orgC.id,
        subscriptionTier: ORG_C.tier,
        period: 'MONTHLY',
        totalChannels: ORG_C.channels,
        isLifetime: false,
      },
    });
    await prisma.integration.create({
      data: {
        id: ORG_C.channel.id,
        internalId: `${ORG_C.channel.id}-internal`,
        organizationId: orgC.id,
        name: ORG_C.channel.name,
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'fake-token',
        profile: ORG_C.channel.id,
      },
    });
    const team = [
      [ORG_C.owner, 'SUPERADMIN'],
      [ORG_C.admin, 'ADMIN'],
      [ORG_C.user, 'USER'],
      [ORG_C.other, 'USER'],
      [ORG_C.leaver, 'USER'],
    ] as const;
    for (const [account, role] of team) {
      const user = await prisma.user.create({
        data: {
          email: account.email,
          password: hashSync(account.password, 10),
          providerName: 'LOCAL',
          name: 'Stack',
          lastName: role,
          timezone: 0,
          activated: true,
          createdAt: new Date(Date.now() - 2 * 86_400_000),
        },
      });
      await prisma.userOrganization.create({
        data: { userId: user.id, organizationId: orgC.id, role },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
};
