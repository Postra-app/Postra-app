jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

// node-telegram-bot-api 2.x throws "A bot token is required" when its client
// is built. Built at import time, that took the whole backend down wherever
// TELEGRAM_TOKEN is not set (the stack tests, a self-hosted install without
// Telegram): every provider is imported at boot.
describe('Telegram without TELEGRAM_TOKEN', () => {
  const token = process.env.TELEGRAM_TOKEN;
  beforeAll(() => delete process.env.TELEGRAM_TOKEN);
  afterAll(() => (process.env.TELEGRAM_TOKEN = token));

  it('can be imported, so the backend still boots', () => {
    jest.isolateModules(() => {
      expect(() =>
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@gitroom/nestjs-libraries/integrations/social/telegram.provider')
      ).not.toThrow();
    });
  });
});
