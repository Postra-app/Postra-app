/**
 * E2E-04-25 (INT-2): connecting a Telegram chat took its id or @username and
 * nothing else. The proof that the person connecting controls the chat —
 * posting "/connect <word>" in it — was checked only by the polling, so
 * anyone could connect a chat the shared bot was in by naming it.
 */
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));

const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    set: jest.fn(async (k: string, v: string) => { store.set(k, v); return 'OK'; }),
    getdel: jest.fn(async (k: string) => { const v = store.get(k) ?? null; store.delete(k); return v; }),
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  },
}));

const bot = {
  getChat: jest.fn(async () => ({ id: -100123, title: 'Their channel', username: 'theirchannel' })),
  getFileLink: jest.fn(),
  getUpdates: jest.fn(async () => [
    { update_id: 7, channel_post: { text: '/connect w0rd', chat: { id: -100123 }, message_id: 5 } },
  ]),
  getMe: jest.fn(async () => ({ id: 1 })),
  getChatMember: jest.fn(async () => ({ status: 'member' })),
  getChatAdministrators: jest.fn(async () => []),
  sendMessage: jest.fn(async () => ({ message_id: 6 })),
  deleteMessage: jest.fn(),
};
jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => bot));

import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';

describe('Connecting a Telegram chat', () => {
  beforeEach(() => store.clear());

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
});
