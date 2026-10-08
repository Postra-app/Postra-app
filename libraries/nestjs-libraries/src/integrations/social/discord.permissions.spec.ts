jest.mock('@gitroom/nestjs-libraries/media/fetch.media.buffer', () => ({
  fetchMediaBlob: jest.fn(),
}));

import { DiscordProvider } from './discord.provider';

// The bot is invited with a permission mask. Without View Channel, Attach
// Files and Read Message History it only worked on servers that give them to
// everyone: posts with media and post statistics failed elsewhere (Codex).
const bits = async () => {
  const { url } = await new DiscordProvider().generateAuthUrl();
  return BigInt(new URL(url).searchParams.get('permissions') || '0');
};
const has = (mask: bigint, bit: number) => (mask >> BigInt(bit)) & 1n;

describe('Discord bot permissions', () => {
  it.each([
    ['VIEW_CHANNEL', 10],
    ['SEND_MESSAGES', 11],
    ['ATTACH_FILES', 15],
    ['READ_MESSAGE_HISTORY', 16],
    ['CREATE_PUBLIC_THREADS', 35],
    ['SEND_MESSAGES_IN_THREADS', 38],
  ])('asks for %s', async (_name, bit) => {
    expect(has(await bits(), bit)).toBe(1n);
  });

  it('asks for nothing that moderates or administers the server', async () => {
    const mask = await bits();
    for (const bit of [3, 4, 5, 13, 28]) {
      expect(has(mask, bit)).toBe(0n);
    }
  });
});
