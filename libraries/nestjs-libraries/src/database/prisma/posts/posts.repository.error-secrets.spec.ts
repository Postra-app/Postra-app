import { PostsRepository } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.repository';

// E2E-09-01: a failed publish wrote the whole in-flight post list into
// Errors.body, and each post carries its full Integration row because
// publishing needs the token. Measured on production: 103 plaintext
// token/refreshToken values across 100 rows, all Instagram and YouTube — the
// providers that refresh, which write the new token back onto the same object.
//
// The repository is built by hand rather than through Nest: its dependencies
// are plain `{ model }` holders, so a fake is enough to run the real method.

const postUpdate = jest.fn();
const errorsCreate = jest.fn();

const build = () =>
  new PostsRepository(
    { model: { post: { update: postUpdate } } } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    { model: { errors: { create: errorsCreate } } } as any,
    {} as any
  );

const failedPostList = [
  {
    id: 'post-1',
    content: 'Good morning',
    integration: {
      id: 'int-1',
      name: 'My IG',
      providerIdentifier: 'instagram',
      token: 'IGAAQ1234567890abcdefPLAINTEXT',
      refreshToken: 'IGAAQrefresh0987654321PLAINTEXT',
      customInstanceDetails: '{"key":"k"}',
      disabled: false,
    },
  },
];

describe('changeState does not write credentials into Errors', () => {
  beforeEach(() => {
    postUpdate.mockResolvedValue({
      id: 'post-1',
      organizationId: 'org-1',
      integration: { providerIdentifier: 'instagram' },
    });
    errorsCreate.mockResolvedValue({});
  });

  const writtenRow = () => errorsCreate.mock.calls[0][0].data;

  it('redacts the tokens carried by the failing post list', async () => {
    await build().changeState('post-1', 'ERROR', 'Session expired', failedPostList);

    const { body } = writtenRow();
    expect(body).not.toContain('IGAAQ1234567890abcdefPLAINTEXT');
    expect(body).not.toContain('IGAAQrefresh0987654321PLAINTEXT');
    expect(body).toContain('[redacted]');
  });

  it('keeps everything support needs to diagnose the failure', async () => {
    await build().changeState('post-1', 'ERROR', 'Session expired', failedPostList);

    const row = writtenRow();
    expect(row.message).toBe('Session expired');
    expect(row.platform).toBe('instagram');
    expect(row.organizationId).toBe('org-1');
    expect(row.postId).toBe('post-1');

    const body = JSON.parse(row.body);
    expect(body[0].content).toBe('Good morning');
    expect(body[0].integration.providerIdentifier).toBe('instagram');
    expect(body[0].integration.name).toBe('My IG');
    expect(body[0].integration.disabled).toBe(false);
  });

  it('redacts a body that arrives already serialised', async () => {
    await build().changeState(
      'post-1',
      'ERROR',
      'Session expired',
      JSON.stringify(failedPostList)
    );

    expect(writtenRow().body).not.toContain('IGAAQ1234567890abcdefPLAINTEXT');
  });

  it('redacts an error object that carries a token of its own', async () => {
    await build().changeState(
      'post-1',
      'ERROR',
      { message: 'refresh failed', access_token: 'ya29.PLAINTEXT' },
      failedPostList
    );

    const row = writtenRow();
    expect(row.message).not.toContain('ya29.PLAINTEXT');
    expect(row.message).toContain('refresh failed');
  });

  it('writes no error row at all when the state is not ERROR', async () => {
    await build().changeState('post-1', 'PUBLISHED');
    expect(errorsCreate).not.toHaveBeenCalled();
  });
});
