import { APIRequestContext, expect, request as pwRequest } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcrypt';
import { UserKey, USERS } from './seed';

export const BACKEND_URL = 'http://localhost:53000';

export const stateFile = (user: UserKey) => `${__dirname}/.auth/${user}.json`;

// A request context signed in as one of the seeded users. Each spec owns its
// contexts and disposes them in afterAll.
export const signedIn = (user: UserKey) =>
  pwRequest.newContext({
    baseURL: BACKEND_URL,
    storageState: stateFile(user),
  });

export const anonymous = () => pwRequest.newContext({ baseURL: BACKEND_URL });

export const channelOf = (user: 'a' | 'b') => USERS[user].channel.id;

const inDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString();

// The body the composer sends for "Save as draft" on one channel.
export const draftBody = (
  user: 'a' | 'b',
  content: string,
  overrides: Record<string, unknown> = {}
) => ({
  type: 'draft',
  shortLink: false,
  date: inDays(2),
  tags: [],
  posts: [
    {
      type: 'draft',
      integration: { id: channelOf(user) },
      value: [{ content, image: [] }],
      settings: { __type: 'bluesky' },
    },
  ],
  ...overrides,
});

type Minified = { p: { i: string; c: string; g: string }[] };

// GET /posts answers in the minified calendar shape: { p: [{ i, c, g, … }] }.
export const listPosts = async (api: APIRequestContext) => {
  const res = await api.get(
    `/posts?startDate=${inDays(-7)}&endDate=${inDays(30)}`
  );
  expect(res.status(), 'GET /posts').toBe(200);
  const body: Minified = await res.json();
  return body.p.map((p) => ({ id: p.i, group: p.g, content: p.c }));
};

export const createDraft = async (
  api: APIRequestContext,
  user: 'a' | 'b',
  content: string
) => {
  const res = await api.post('/posts', { data: draftBody(user, content) });
  expect(res.status(), `create draft: ${await res.text()}`).toBe(201);
  const post = (await listPosts(api)).find((p) => p.content.includes(content));
  expect(post, 'created draft is listed').toBeTruthy();
  return post!;
};

// Direct database access for state the API cannot build cheaply (hundreds of
// posts, a trial). Stack stores only — see seed.ts.
export const database = () =>
  new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

let throwawayCount = 0;

// A fresh organisation with one signed-in owner, for tests that must push an
// org to a limit without disturbing the seeded ones other specs share.
// `channels` Bluesky channels are created up front. Call `remove` in afterAll.
export const throwawayOrg = async (
  prisma: PrismaClient,
  options: {
    tier: 'STANDARD' | 'PRO' | 'ULTIMATE';
    totalChannels: number;
    channels: number;
    isTrailing?: boolean;
  }
) => {
  const tag = `${process.pid}-${Date.now()}-${++throwawayCount}`;
  const email = `throwaway-${tag}@example.com`;
  const password = 'Stack-tests-T-1';
  const org = await prisma.organization.create({
    data: {
      name: `Stack throwaway ${tag}`,
      apiKey: `stack-api-key-${tag}`,
      isTrailing: !!options.isTrailing,
    },
  });
  const user = await prisma.user.create({
    data: {
      email,
      password: hashSync(password, 10),
      providerName: 'LOCAL',
      name: 'Stack',
      lastName: 'Throwaway',
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
      subscriptionTier: options.tier,
      period: 'MONTHLY',
      totalChannels: options.totalChannels,
      isLifetime: false,
    },
  });
  const channelIds: string[] = [];
  for (let i = 0; i < options.channels; i++) {
    const id = `stack-throwaway-${tag}-${i}`;
    await prisma.integration.create({
      data: {
        id,
        internalId: `${id}-internal`,
        organizationId: org.id,
        name: `Throwaway Bluesky ${i}`,
        providerIdentifier: 'bluesky',
        type: 'social',
        token: 'fake-token',
        profile: id,
      },
    });
    channelIds.push(id);
  }

  // Login allows 5 attempts per address; every throwaway signs in from its own.
  const api = await pwRequest.newContext({
    baseURL: BACKEND_URL,
    extraHTTPHeaders: {
      'x-forwarded-for': `198.18.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`,
    },
  });
  const res = await api.post('/auth/login', {
    data: { email, password, provider: 'LOCAL' },
  });
  expect(res.status(), `throwaway sign-in: ${await res.text()}`).toBe(200);

  return {
    api,
    orgId: org.id,
    channelIds,
    remove: async () => {
      await api.dispose();
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.user.delete({ where: { id: user.id } });
    },
  };
};
