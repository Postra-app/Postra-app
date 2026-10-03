import { APIRequestContext, expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { database, listPosts, signedIn, throwawayOrg } from '../helpers';
import { ORG_C } from '../seed';

// Several people working in one agency (Plan/testing.md §9): Organisation C
// is a Business team (owner, ADMIN, three USERs) on one channel. What is
// measured here: everyone sees one calendar, anyone in the team can change a
// teammate's post, two people saving the same post, and one person who works
// for two organisations.
test.describe.configure({ mode: 'serial' });

const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const body = (content: string, group: string, valueId?: string) => ({
  type: 'draft',
  shortLink: false,
  date: inDays(3),
  tags: [],
  posts: [
    {
      integration: { id: ORG_C.channel.id },
      group,
      settings: { __type: 'bluesky' },
      value: [{ ...(valueId ? { id: valueId } : {}), content, image: [] }],
    },
  ],
});

// The server gives a new post its own group id; find it by content.
const create = async (api: APIRequestContext, content: string) => {
  const res = await api.post('/posts', { data: body(content, 'new') });
  expect(res.status(), await res.text()).toBe(201);
};
const groupOf = async (api: APIRequestContext, content: string) => {
  const post = (await listPosts(api)).find((p) => p.content.includes(content));
  expect(post, `"${content}" on the calendar`).toBeTruthy();
  return post!.group;
};

const read = async (api: APIRequestContext, group: string) => {
  const res = await api.get(`/posts/group/${group}`);
  return { status: res.status(), json: res.status() === 200 ? await res.json() : null };
};

let owner: APIRequestContext;
let admin: APIRequestContext;
let user: APIRequestContext;
let prisma: PrismaClient;
test.beforeAll(async () => {
  owner = await signedIn('c-owner');
  admin = await signedIn('c-admin');
  user = await signedIn('c-user');
  prisma = database();
});
test.afterAll(async () => {
  await owner.dispose();
  await admin.dispose();
  await user.dispose();
  await prisma.$disconnect();
});

test('one calendar: a post written by a USER is on everyone\'s calendar', async () => {
  const content = `Shared calendar ${Date.now()}`;
  await create(user, content);
  const group = await groupOf(user, content);
  for (const [who, api] of [['owner', owner], ['admin', admin], ['user', user]] as const) {
    const posts = await listPosts(api);
    expect(posts.some((p) => p.group === group), who).toBe(true);
  }
  await owner.delete(`/posts/${group}`);
});

test('a teammate can edit and delete a post someone else wrote', async () => {
  const tag = `teammate-${Date.now()}`;
  await create(admin, `By the admin ${tag}`);
  const group = await groupOf(admin, tag);
  const valueId = (await read(user, group)).json.posts[0].id;

  // A save keeps the post's id and gives it a new group (upstream design).
  expect((await user.post('/posts', { data: body(`Edited by a user ${tag}`, group, valueId) })).status()).toBe(201);
  const edited = await groupOf(admin, `Edited by a user ${tag}`);
  expect((await read(admin, edited)).json.posts[0].id).toBe(valueId);

  expect((await (await user.delete(`/posts/${edited}`)).json()).deleted).toBe(true);
  expect((await read(admin, edited)).status).toBe(404);
});

// Two people open the same post; the second save is built on what they saw
// before the first one saved. Measured, not wished: the last save wins and
// nobody is warned.
test('two people saving the same post: the last save wins', async () => {
  const tag = `concurrent-${Date.now()}`;
  await create(owner, `Original ${tag}`);
  const group = await groupOf(owner, tag);
  const seenByAdmin = (await read(admin, group)).json.posts[0].id;
  const seenByUser = (await read(user, group)).json.posts[0].id;

  expect((await admin.post('/posts', { data: body(`Admin's version ${tag}`, group, seenByAdmin) })).status()).toBe(201);
  const second = await user.post('/posts', { data: body(`User's version ${tag}`, group, seenByUser) });
  expect(second.status()).toBe(201);

  const mine = (await listPosts(owner)).filter((p) => p.content.includes(tag));
  expect(mine, 'one post left, not two').toHaveLength(1);
  expect(mine[0].content).toContain("User's version");
  await owner.delete(`/posts/${mine[0].group}`);
});

// A person working for two organisations: the USER of C accepts an invite to
// another agency through the real link. The new organisation must be usable
// straight away (the auth context is cached for 30 s), and each one shows only
// its own channels and posts.
test('one person in two organisations sees each one separately', async () => {
  const other = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const person = await prisma.user.findFirstOrThrow({ where: { email: ORG_C.user.email } });
  const orgC = await prisma.organization.findFirstOrThrow({ where: { name: ORG_C.org } });
  const as = (orgId: string) => ({ headers: { showorg: orgId } });
  try {
    // Warm the cached auth context, as an open tab would.
    expect((await user.get('/user/organizations')).status()).toBe(200);

    const invite = await other.api.post('/settings/team', {
      data: { email: ORG_C.user.email, role: 'USER', sendEmail: false },
    });
    expect(invite.status(), await invite.text()).toBe(201);
    const token = new URL((await invite.json()).url).searchParams.get('org');
    const joined = await user.post('/user/join-org', { data: { org: token } });
    expect((await joined.json()).id).toBe(other.orgId);

    const orgs: { id: string }[] = await (await user.get('/user/organizations')).json();
    expect(orgs.map((o) => o.id).sort()).toEqual([orgC.id, other.orgId].sort());
    const channelsThere: { id: string }[] = (await (await user.get('/integrations/list', as(other.orgId))).json()).integrations;
    expect(channelsThere.map((c) => c.id), 'the new organisation right after joining').toEqual(other.channelIds);
    const channelsHere: { id: string }[] = (await (await user.get('/integrations/list', as(orgC.id))).json()).integrations;
    expect(channelsHere.map((c) => c.id)).toEqual([ORG_C.channel.id]);

    // A post written in the other organisation stays there.
    const tag = `two-orgs-${Date.now()}`;
    const draft = body(`In the other org ${tag}`, 'new');
    draft.posts[0].integration = { id: other.channelIds[0] };
    const made = await user.post('/posts', { data: draft, ...as(other.orgId) });
    expect(made.status(), await made.text()).toBe(201);
    const there = await user.get(`/posts?startDate=${inDays(-1)}&endDate=${inDays(30)}`, as(other.orgId));
    expect(((await there.json()).p as { c: string }[]).some((p) => p.c.includes(tag))).toBe(true);
    expect((await listPosts(user)).some((p) => p.content.includes(tag)), 'not in organisation C').toBe(false);
    expect((await listPosts(owner)).some((p) => p.content.includes(tag)), 'the owner of C').toBe(false);
  } finally {
    await prisma.userOrganization.deleteMany({ where: { userId: person.id, organizationId: other.orgId } });
    await other.remove();
  }
});
