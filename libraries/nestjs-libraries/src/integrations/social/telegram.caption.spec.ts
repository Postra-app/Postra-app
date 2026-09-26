/**
 * E2E-05-06 — measured on production 2026-09-26: 1181 characters + one image
 * passed validation, then Telegram answered "400 Bad Request: message caption
 * is too long", and Temporal retried that certain failure for ~4.5 minutes.
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

const bot = {
  sendMessage: jest.fn(),
  sendPhoto: jest.fn(),
  sendVideo: jest.fn(),
  sendDocument: jest.fn(),
  sendMediaGroup: jest.fn(),
};
jest.mock('node-telegram-bot-api', () => jest.fn().mockImplementation(() => bot));

import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';

const provider = new TelegramProvider();
jest
  .spyOn(provider as any, 'resolveMedia')
  .mockImplementation(async (m: any) => m);

const photo = [{ path: 'https://cdn/x.jpg' }] as any;
const post = (message: string, media: any[] = []) =>
  provider.post('PostraAPP', '-100123', [{ id: 'p1', message, media, settings: {} } as any]);

beforeEach(() => {
  jest.clearAllMocks();
  bot.sendPhoto.mockResolvedValue({ message_id: 7 });
  bot.sendMessage.mockResolvedValue({ message_id: 8 });
  bot.sendMediaGroup.mockResolvedValue([{ message_id: 7 }]);
});

describe('Telegram caption limit', () => {
  it('keeps a short text as the caption, in one message', async () => {
    await post('<p>short</p>', photo);
    expect(bot.sendPhoto.mock.calls[0][2].caption).toContain('short');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a caption over 1024 as its own message, replying to the photo', async () => {
    const long = 'a'.repeat(1181);
    const [res] = await post(long, photo);
    expect(bot.sendPhoto.mock.calls[0][2].caption).toBeUndefined();
    expect(bot.sendMessage).toHaveBeenCalledWith('-100123', long, {
      parse_mode: 'HTML',
      reply_to_message_id: 7,
    });
    expect(res.releaseURL).toBe('https://t.me/PostraAPP/7');
  });

  it('does the same for a media group', async () => {
    await post('a'.repeat(1100), [...photo, { path: 'https://cdn/y.jpg' }]);
    expect(bot.sendMediaGroup.mock.calls[0][1][0].caption).toBeUndefined();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram 4xx', () => {
  it('becomes a non-retryable BadBody with Telegram’s own sentence', async () => {
    bot.sendMessage.mockRejectedValue(
      Object.assign(new Error('ETELEGRAM: 400 Bad Request: chat not found'), {
        code: 'ETELEGRAM',
        response: { statusCode: 400, body: { error_code: 400, description: 'Bad Request: chat not found' } },
      })
    );
    const err = await post('hi').catch((e) => e);
    expect(err).toBeInstanceOf(BadBody);
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe('Bad Request: chat not found');
  });

  it('leaves rate limits and network errors retryable', async () => {
    for (const e of [
      Object.assign(new Error('ETELEGRAM: 429'), { code: 'ETELEGRAM', response: { body: { error_code: 429 } } }),
      Object.assign(new Error('socket hang up'), { code: 'EFATAL' }),
    ]) {
      bot.sendMessage.mockRejectedValueOnce(e);
      const err = await post('hi').catch((x) => x);
      expect(err).not.toBeInstanceOf(BadBody);
    }
  });
});
