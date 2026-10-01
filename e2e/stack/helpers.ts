import { APIRequestContext, expect, request as pwRequest } from '@playwright/test';
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
