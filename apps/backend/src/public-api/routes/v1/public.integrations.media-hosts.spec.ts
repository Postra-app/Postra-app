import { HttpException } from '@nestjs/common';
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
import { PublicIntegrationsController } from './public.integrations.controller';

// RESTRICT_UPLOAD_DOMAINS is a comma-separated list of hosts everywhere else
// (own.media.url.ts). The public API compared the whole value as a substring of
// each media URL: a list refused every upload, and a URL that merely contained
// the domain (in its query, say) passed.

const post = (path: string) => ({
  integration: { id: 'integration-1' },
  value: [{ content: 'hello', image: [{ id: 'media-1', path }] }],
  settings: {},
});

const org = { id: 'org-1', createdAt: new Date(), isTrailing: false } as any;

const make = () => {
  const posts = {
    mapTypeToPost: jest.fn(async (body: any) => body),
    validatePosts: jest.fn(async () => []),
    createPost: jest.fn(async () => [{ postId: 'post-1' }]),
  };
  const permissions = { postCap: jest.fn(async () => 10) };
  const controller = new PublicIntegrationsController(
    {} as any,
    posts as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    permissions as any
  );
  return { controller, posts };
};

describe('public API media hosts', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env, NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY: '', FRONTEND_URL: '' };
  });
  afterAll(() => {
    process.env = env;
  });

  it('accepts media on any host of the list', async () => {
    process.env.RESTRICT_UPLOAD_DOMAINS = 'media.example.com, cdn.example.com';
    const { controller, posts } = make();
    await controller.createPost(org, {
      type: 'draft',
      posts: [post('https://cdn.example.com/a.png'), post('https://media.example.com/b.png')],
    });
    expect(posts.createPost).toHaveBeenCalledTimes(1);
  });

  it('refuses a URL that only contains a listed host', async () => {
    process.env.RESTRICT_UPLOAD_DOMAINS = 'cdn.example.com';
    const { controller, posts } = make();
    await expect(
      controller.createPost(org, {
        type: 'draft',
        posts: [post('https://evil.example/x.png?cdn.example.com')],
      })
    ).rejects.toBeInstanceOf(HttpException);
    expect(posts.createPost).not.toHaveBeenCalled();
  });

  it('refuses media of another host when the CDN is configured', async () => {
    process.env.RESTRICT_UPLOAD_DOMAINS = '';
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = 'https://cdn.example.com';
    const { controller, posts } = make();
    await expect(
      controller.createPost(org, { type: 'draft', posts: [post('https://other.example/x.png')] })
    ).rejects.toBeInstanceOf(HttpException);
    expect(posts.createPost).not.toHaveBeenCalled();
  });

  it('checks nothing on an install with no media host configured', async () => {
    process.env.RESTRICT_UPLOAD_DOMAINS = '';
    const { controller, posts } = make();
    await controller.createPost(org, { type: 'draft', posts: [post('https://any.example/x.png')] });
    expect(posts.createPost).toHaveBeenCalledTimes(1);
  });
});
