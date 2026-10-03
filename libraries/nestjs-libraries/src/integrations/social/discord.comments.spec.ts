import { DiscordProvider } from './discord.provider';

// Comments on a Discord post go into a thread opened from the post. The second
// and later comments used to land in the channel itself, outside the thread.
describe('Discord comments', () => {
  const calls: string[] = [];
  const provider = new DiscordProvider();
  (provider as any).fetch = jest.fn(async (url: string) => {
    calls.push(url);
    const body = url.endsWith('/threads') ? { id: 'post-1' } : { id: `msg-${calls.length}` };
    return { json: async () => body } as any;
  });
  const details = (id: string) => [{ id, message: 'comment', settings: { channel: 'chan-9' }, media: [] }] as any;

  beforeEach(() => calls.splice(0));

  it('opens a thread under the post for the first comment and writes into it', async () => {
    const [res] = await provider.comment('guild', 'post-1', undefined, 'tok', details('c1'), {} as any);
    expect(calls).toEqual([
      'https://discord.com/api/channels/chan-9/messages/post-1/threads',
      'https://discord.com/api/channels/post-1/messages',
    ]);
    expect(res.releaseURL).toBe(`https://discord.com/channels/guild/post-1/${res.postId}`);
  });

  it('writes every later comment into the same thread, not the channel', async () => {
    await provider.comment('guild', 'post-1', 'msg-prev', 'tok', details('c2'), {} as any);
    expect(calls).toEqual(['https://discord.com/api/channels/post-1/messages']);
  });
});
