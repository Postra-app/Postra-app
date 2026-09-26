/**
 * E2E-05-13 — GET /public/posts/:id is unauthenticated and used to return the
 * whole Post row: Post.error (Temporal JSON with stack traces), organization
 * and group ids, settings. Only what /p/[id] renders may leave.
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
}));

import { PublicController } from './public.controller';

const row: any = {
  id: 'p1',
  content: '<p>hello</p>',
  image: '[{"id":"m1","path":"https://cdn/x.jpg"}]',
  publishDate: new Date('2026-09-26T15:31:53Z'),
  creationMethod: 'WEB',
  state: 'ERROR',
  error: '{"cause":{"stackTrace":"at /app/node_modules/x.js"},"access_token":"EAAsecret"}',
  organizationId: 'org-1',
  integrationId: 'int-1',
  group: 'g1',
  settings: '{"__type":"telegram"}',
  releaseId: 'r1',
  deletedAt: null,
  childrenPost: [],
  integration: {
    id: 'int-1',
    name: 'Postra',
    picture: 'https://cdn/p.png',
    providerIdentifier: 'telegram',
    profile: 'postra',
    token: 'secret-token',
    refreshToken: 'secret-refresh',
    organizationId: 'org-1',
  },
};

function controller(rows: any[]) {
  const posts = { getPostsRecursively: jest.fn().mockResolvedValue(rows) };
  return new PublicController({} as any, {} as any, posts as any, {} as any);
}

describe('PublicController.getPreview', () => {
  it('returns only the fields the preview page renders', async () => {
    const [out] = await controller([row]).getPreview('p1');
    expect(Object.keys(out).sort()).toEqual(
      ['content', 'creationMethod', 'id', 'image', 'integration', 'publishDate'].sort()
    );
    expect(Object.keys((out as any).integration).sort()).toEqual(
      ['id', 'name', 'picture', 'profile', 'providerIdentifier'].sort()
    );
  });

  it('never sends the failure text or anything secret-shaped', async () => {
    const body = JSON.stringify(await controller([row]).getPreview('p1'));
    for (const leak of ['stackTrace', 'EAAsecret', 'secret-token', 'secret-refresh', 'org-1', '"group"', '"state"']) {
      expect(body).not.toContain(leak);
    }
  });

  it('keeps a post whose channel was removed', async () => {
    const [out] = await controller([{ ...row, integration: null }]).getPreview('p1');
    expect(out).not.toHaveProperty('integration');
    expect(out.content).toBe('<p>hello</p>');
  });
});

describe('PublicController.getComments (E2E-05-16)', () => {
  const rows: any[] = [
    { id: 'c1', content: 'hi', createdAt: new Date(), userId: 'user-a', organizationId: 'org-1', postId: 'p1', deletedAt: null, updatedAt: new Date() },
    { id: 'c2', content: 'yo', createdAt: new Date(), userId: 'user-b', organizationId: 'org-1', postId: 'p1', deletedAt: null, updatedAt: new Date() },
    { id: 'c3', content: 'again', createdAt: new Date(), userId: 'user-a', organizationId: 'org-1', postId: 'p1', deletedAt: null, updatedAt: new Date() },
  ];
  const ctrl = () =>
    new PublicController({} as any, {} as any, { getComments: jest.fn().mockResolvedValue(rows) } as any, {} as any);

  it('sends no real user or organization id', async () => {
    const body = JSON.stringify(await ctrl().getComments('p1'));
    for (const leak of ['user-a', 'user-b', 'org-1', 'organizationId']) {
      expect(body).not.toContain(leak);
    }
  });

  it('keeps authors groupable: same person, same alias; different people differ', async () => {
    const { comments } = await ctrl().getComments('p1');
    expect(comments[0].userId).toBe(comments[2].userId);
    expect(comments[0].userId).not.toBe(comments[1].userId);
    expect(Object.keys(comments[0]).sort()).toEqual(['content', 'createdAt', 'id', 'userId']);
  });
});
