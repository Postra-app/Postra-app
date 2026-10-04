import { PostsRepository } from './posts.repository';

// Webhooks after a publish: the workflow hands over the platform's post id
// (stored on our row as releaseId), and the lookup by our id found nothing —
// every webhook body was [] (upstream b1930421).
describe('the post a webhook describes', () => {
  const ours = { id: 'post-1', releaseId: 'platform-77', integrationId: 'ch-1', content: 'Hello' };
  const findMany = jest.fn(async ({ where }: any) =>
    [ours].filter(
      (p) =>
        (where.id === undefined || p.id === where.id) &&
        (where.releaseId === undefined || p.releaseId === where.releaseId) &&
        (where.integrationId === undefined || p.integrationId === where.integrationId)
    )
  );
  const repository = new PostsRepository(
    { model: { post: { findMany } } } as any,
    ...([{}, {}, {}, {}, {}, {}] as any[])
  );
  afterEach(() => findMany.mockClear());

  it('is found by our id', async () => {
    expect(await repository.getPostByForWebhookId('post-1', 'ch-1')).toEqual([ours]);
  });

  it('is found by the platform id the workflow passes, on that channel', async () => {
    expect(await repository.getPostByForWebhookId('platform-77', 'ch-1')).toEqual([ours]);
    expect(await repository.getPostByForWebhookId('platform-77', 'another-channel')).toEqual([]);
  });
});
