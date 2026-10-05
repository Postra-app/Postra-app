import { DiscordProvider } from './discord.provider';

// E2E-04-21 (INT-1): the bot is shared by every organisation and a channel id
// is no secret, so a post naming a channel of another organisation's server
// went there. Only channels of the connected server are written to.
describe('Discord posts stay in the connected server', () => {
  const calls: { url: string; method: string }[] = [];
  const provider = new DiscordProvider();
  const channelGuild: Record<string, string> = { 'ours-1': 'guild-a', 'theirs-1': 'guild-b' };
  (provider as any).fetch = jest.fn(async (url: string, init: { method?: string } = {}) => {
    calls.push({ url, method: init.method || 'GET' });
    const channel = url.match(/channels\/([^/]+)$/)?.[1];
    const body = channel && !init.method ? { id: channel, guild_id: channelGuild[channel] } : { id: 'msg-1' };
    return { json: async () => body } as any;
  });
  const post = (channel: string) => [{ id: 'p1', message: 'hello', settings: { channel }, media: [] }] as any;

  beforeEach(() => calls.splice(0));

  it("posts to a channel of the connected server", async () => {
    const [res] = await provider.post('guild-a', 'tok', post('ours-1'));
    expect(res.postId).toBe('msg-1');
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/channels/ours-1/messages'))).toBe(true);
  });

  it("refuses a channel of another server without writing to it", async () => {
    await expect(provider.post('guild-a', 'tok', post('theirs-1'))).rejects.toThrow();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });
});
