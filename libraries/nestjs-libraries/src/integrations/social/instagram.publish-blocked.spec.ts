jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { META_GRAPH_API_VERSION } from '@gitroom/nestjs-libraries/integrations/social/meta.graph.version';
import {
  IG_BLOCKED,
  InstagramProvider,
} from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

// Upstream ae0a642b0: Instagram answers media_publish with 2207051 ("action is
// blocked") and still publishes the container. The post was failed although
// it was live on Instagram.
describe('InstagramProvider.publishContainer', () => {
  const json = (body: unknown) => ({ json: async () => body }) as Response;
  const blocked = () => new BadBody('instagram', '{}', '{}', IG_BLOCKED);

  const provider = (answers: Record<string, () => unknown>) => {
    const p = new InstagramProvider();
    const calls: string[] = [];
    jest.spyOn(p, 'fetch').mockImplementation(async (url: string) => {
      calls.push(url);
      const key = Object.keys(answers).find((k) => url.includes(k));
      const answer = key ? answers[key]() : undefined;
      if (answer instanceof Error) throw answer;
      return json(answer);
    });
    return { p, calls };
  };

  const publish = (p: InstagramProvider) =>
    p.publishContainer('graph.facebook.com', 'ig-1', 'container-9', 'page-token', 'user-token', 'Hello Bristol');

  it('returns the media Instagram created when it published despite the error', async () => {
    const { p, calls } = provider({
      media_publish: () => blocked(),
      'container-9?fields=status_code': () => ({ status_code: 'PUBLISHED' }),
      'ig-1/media?fields=id,caption': () => ({ data: [{ id: 'media-42', caption: 'Hello Bristol' }] }),
    });

    await expect(publish(p)).resolves.toBe('media-42');
    expect(calls.filter((u) => u.includes('user-token'))).toHaveLength(2);
    // The app's Graph version, not an expired one.
    expect(calls.slice(1).every((u) => u.includes(`/${META_GRAPH_API_VERSION}/`))).toBe(true);
  });

  it('takes the media with this caption, not a post published in between', async () => {
    const { p } = provider({
      media_publish: () => blocked(),
      'container-9?fields=status_code': () => ({ status_code: 'PUBLISHED' }),
      'ig-1/media?fields=id,caption': () => ({
        data: [
          { id: 'someone-else', caption: 'Posted from the phone' },
          { id: 'media-42', caption: ' Hello Bristol ' },
        ],
      }),
    });
    await expect(publish(p)).resolves.toBe('media-42');
  });

  it('keeps the error when no media, or more than one, has the caption', async () => {
    for (const data of [
      [{ id: 'x', caption: 'Something else' }],
      [{ id: 'a', caption: 'Hello Bristol' }, { id: 'b', caption: 'Hello Bristol' }],
    ]) {
      const { p } = provider({
        media_publish: () => blocked(),
        'container-9?fields=status_code': () => ({ status_code: 'PUBLISHED' }),
        'ig-1/media?fields=id,caption': () => ({ data }),
      });
      await expect(publish(p)).rejects.toThrow(IG_BLOCKED);
    }
  });

  it('keeps the error when the container was not published', async () => {
    const { p, calls } = provider({
      media_publish: () => blocked(),
      'container-9?fields=status_code': () => ({ status_code: 'FINISHED' }),
    });

    await expect(publish(p)).rejects.toThrow(IG_BLOCKED);
    expect(calls.some((u) => u.includes('/media?fields=id'))).toBe(false);
  });

  it('keeps the error when the status check itself fails', async () => {
    const { p } = provider({
      media_publish: () => blocked(),
      'container-9?fields=status_code': () => new Error('socket hang up'),
    });

    await expect(publish(p)).rejects.toThrow(IG_BLOCKED);
  });

  it('does not ask Instagram about any other error', async () => {
    const { p, calls } = provider({
      media_publish: () => new BadBody('instagram', '{}', '{}', 'Media ID is not available'),
    });

    await expect(publish(p)).rejects.toThrow('Media ID is not available');
    expect(calls).toHaveLength(1);
  });

  it('publishes as before when Instagram accepts', async () => {
    const { p } = provider({ media_publish: () => ({ id: 'media-1' }) });
    await expect(publish(p)).resolves.toBe('media-1');
  });

  it('maps 2207051 to the message publishContainer looks for', () => {
    expect(
      new InstagramProvider().handleErrors(
        JSON.stringify({ error: { code: 4, error_subcode: 2207051 } }),
        400
      )
    ).toEqual({ type: 'bad-body', value: IG_BLOCKED });
  });
});
