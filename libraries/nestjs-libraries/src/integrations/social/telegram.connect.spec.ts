/**
 * E2E-04-25 (INT-2): connecting a Telegram chat took its id or @username and
 * nothing else. The proof that the person connecting controls the chat —
 * posting "/connect <word>" in it — was checked only by the polling, so
 * anyone could connect a chat the shared bot was in by naming it.
 */
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

const store = new Map<string, string>();
const lists = new Map<string, string[]>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string, ...rest: unknown[]) => {
      if (rest.includes('NX') && store.has(k)) return null;
      store.set(k, v);
      return 'OK';
    }),
    getdel: jest.fn(async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v; }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    del: jest.fn(async (k: string) => { store.delete(k); lists.delete(k); return 1; }),
    rpush: jest.fn(async (k: string, ...v: string[]) => { lists.set(k, [...(lists.get(k) ?? []), ...v]); return lists.get(k)!.length; }),
    lrange: jest.fn(async (k: string) => lists.get(k) ?? []),
    ltrim: jest.fn(async () => 'OK'),
    lrem: jest.fn(async (k: string, _n: number, v: string) => { lists.set(k, (lists.get(k) ?? []).filter((x) => x !== v)); return 1; }),
    expire: jest.fn(async () => 1),
  },
}));

// Telegram's getUpdates: an offset confirms every earlier update, for every
// caller of the one shared bot.
let pending: any[] = [];
const getUpdates = jest.fn(async (o: { offset?: number } = {}) => {
  if (o.offset) pending = pending.filter((u) => u.update_id >= o.offset!);
  return pending;
});

const bot = {
  getChat: jest.fn(async () => ({ id: -100123, title: 'Their channel', username: 'theirchannel' })),
  getFileLink: jest.fn(),
  getUpdates,
  getMe: jest.fn(async () => ({ id: 1 })),
  getChatMember: jest.fn(async () => ({ status: 'member' })),
  getChatAdministrators: jest.fn(async () => []),
  sendMessage: jest.fn(async () => ({ message_id: 6 })),
  deleteMessage: jest.fn(),
};
jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => bot));

import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';

const connectPost = (update_id: number, word: string, chat = -100123) => ({
  update_id,
  channel_post: { text: `/connect ${word}`, chat: { id: chat }, message_id: update_id },
});

describe('Connecting a Telegram chat', () => {
  beforeEach(() => {
    store.clear();
    lists.clear();
    pending = [connectPost(7, 'w0rd')];
  });

  it('is refused for a chat nobody proved they control', async () => {
    const result = await new TelegramProvider().authenticate({ code: '@theirchannel', codeVerifier: '' });
    expect(result).not.toHaveProperty('accessToken');
  });

  it('goes through once "/connect <word>" was posted in that chat, and only once', async () => {
    const provider = new TelegramProvider();
    expect(await provider.getBotId({ word: 'w0rd' })).toEqual({ chatId: -100123 });
    expect(await provider.authenticate({ code: '-100123', codeVerifier: '' })).toHaveProperty('accessToken', '-100123');
    expect(await provider.authenticate({ code: '-100123', codeVerifier: '' })).not.toHaveProperty('accessToken');
  });

  // E2E-11-69: the browser sent its own offset, so another organisation's
  // wizard polling the shared bot confirmed this one's "/connect" away and
  // the wizard waited for ever.
  it('another organisation polling at the same time does not eat this one\'s /connect', async () => {
    const provider = new TelegramProvider();
    await provider.getBotId({ word: 'other', id: 8 }, 'org-b');
    expect(await provider.getBotId({ word: 'w0rd' }, 'org-a')).toEqual({ chatId: -100123 });
  });

  it('the proof belongs to the organisation whose wizard saw it', async () => {
    const provider = new TelegramProvider();
    expect(await provider.getBotId({ word: 'w0rd' }, 'org-a')).toEqual({ chatId: -100123 });
    expect(
      await provider.authenticate({ code: '-100123', codeVerifier: '', organizationId: 'org-b' })
    ).not.toHaveProperty('accessToken');
  });

  it('the organisation that proved it connects', async () => {
    const provider = new TelegramProvider();
    await provider.getBotId({ word: 'w0rd' }, 'org-a');
    expect(
      await provider.authenticate({ code: '-100123', codeVerifier: '', organizationId: 'org-a' })
    ).toHaveProperty('accessToken', '-100123');
  });

  // Codex 26 X: the proof was spent before the organisation was compared, so
  // another organisation naming the chat made the rightful one post
  // "/connect" again.
  it('a refused attempt by another organisation leaves the proof for the one that earned it', async () => {
    const provider = new TelegramProvider();
    await provider.getBotId({ word: 'w0rd' }, 'org-a');
    await provider.authenticate({ code: '-100123', codeVerifier: '', organizationId: 'org-b' });
    expect(
      await provider.authenticate({ code: '-100123', codeVerifier: '', organizationId: 'org-a' })
    ).toHaveProperty('accessToken', '-100123');
  });
});
