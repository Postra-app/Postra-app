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
// Only the API client is a stand-in; errors and files are the library's own.
jest.mock('node-telegram-bot-api', () => ({
  ...jest.requireActual('node-telegram-bot-api'),
  Api: jest.fn().mockImplementation(() => bot),
}));

import { TelegramProvider } from '@gitroom/nestjs-libraries/integrations/social/telegram.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { TelegramApiError } from 'node-telegram-bot-api';

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
    expect(bot.sendPhoto.mock.calls[0][0]).toMatchObject({
      chat_id: '-100123',
      photo: 'https://cdn/x.jpg',
    });
    expect(bot.sendPhoto.mock.calls[0][0].caption).toContain('short');
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  it('sends a caption over 1024 as its own message, replying to the photo', async () => {
    const long = 'a'.repeat(1181);
    const [res] = await post(long, photo);
    expect(bot.sendPhoto.mock.calls[0][0].caption).toBeUndefined();
    expect(bot.sendMessage).toHaveBeenCalledWith({
      chat_id: '-100123',
      text: long,
      parse_mode: 'HTML',
      reply_parameters: { message_id: 7 },
    });
    expect(res.releaseURL).toBe('https://t.me/PostraAPP/7');
  });

  it('does the same for a media group', async () => {
    await post('a'.repeat(1100), [...photo, { path: 'https://cdn/y.jpg' }]);
    expect(bot.sendMediaGroup.mock.calls[0][0].media[0].caption).toBeUndefined();
    expect(bot.sendMessage).toHaveBeenCalledTimes(1);
  });
});

describe('Telegram 4xx', () => {
  it('becomes a non-retryable BadBody with Telegram’s own sentence', async () => {
    bot.sendMessage.mockRejectedValue(
      new TelegramApiError(400, 'Bad Request: chat not found')
    );
    const err = await post('hi').catch((e) => e);
    expect(err).toBeInstanceOf(BadBody);
    expect(err.nonRetryable).toBe(true);
    expect(err.message).toBe('Bad Request: chat not found');
  });

  it('replies in a thread with reply_parameters, which 2.x sends', async () => {
    bot.sendMessage.mockReset().mockResolvedValue({ message_id: 9 });
    await provider.comment('PostraAPP', '7', undefined, '-100123', [
      { id: 'c1', message: 'next', media: [], settings: {} } as any,
    ], {} as any);
    expect(bot.sendMessage.mock.calls[0][0]).toMatchObject({
      chat_id: '-100123',
      reply_parameters: { message_id: 7 },
    });
    expect(bot.sendMessage.mock.calls[0][0]).not.toHaveProperty('reply_to_message_id');
  });

  it('uploads downloaded bytes as a file, not as a string', async () => {
    const { InputFile } = jest.requireActual('node-telegram-bot-api');
    (provider as any).resolveMedia.mockImplementationOnce(async (m: any) => ({
      ...m,
      media: Buffer.from('jpeg-bytes'),
    }));
    await post('<p>big</p>', photo);
    const sent = bot.sendPhoto.mock.calls[0][0].photo;
    expect(sent).toBeInstanceOf(InputFile);
    expect(sent.meta).toEqual({ filename: 'x.jpg', contentType: 'image/jpeg' });
  });

  it('leaves rate limits and network errors retryable', async () => {
    for (const e of [
      new TelegramApiError(429, 'Too Many Requests: retry after 5', { retry_after: 5 }),
      Object.assign(new Error('socket hang up'), { code: 'EFATAL' }),
    ]) {
      bot.sendMessage.mockRejectedValueOnce(e);
      const err = await post('hi').catch((x) => x);
      expect(err).not.toBeInstanceOf(BadBody);
    }
  });
});

// Telegram's HTML has no <p>: paragraphs become lines. A paragraph with an
// attribute — dir="auto" from the editor (RTL, upstream 1d4b75fa), class from
// the public API — went out as a raw <p …> tag.
describe('Telegram paragraphs', () => {
  it('turns paragraphs with attributes into lines, like plain ones', async () => {
    await post('<p dir="auto">first</p><p class="x">second</p><p>third</p>');
    const { text } = bot.sendMessage.mock.calls[0][0];
    expect(text).not.toMatch(/<\/?p/);
    expect(text).toBe('first\nsecond\nthird\n');
  });
});
