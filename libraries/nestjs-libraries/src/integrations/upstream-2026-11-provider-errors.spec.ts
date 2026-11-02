jest.mock('@gitroom/nestjs-libraries/media/fetch.media.buffer', () => ({
  fetchMediaBlob: jest.fn(),
}));

import 'reflect-metadata';
import {
  BadBody,
  ProcessingTimeout,
  RefreshToken,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { DiscordProvider } from '@gitroom/nestjs-libraries/integrations/social/discord.provider';
import { FacebookDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/facebook.dto';
import { validationMetadatasToSchemas } from 'class-validator-jsonschema';

class Probe extends SocialAbstract {
  identifier = 'probe';
}

// Upstream 0c9d39400: an error the provider had already classified (e.g. the
// X chunked upload's curated size message) came out as "Unknown Error".
describe('runInConcurrent', () => {
  it.each([
    ['a curated bad body', new BadBody('x', '{}', '{}', 'Video is larger than 512 MB')],
    ['a refresh', new RefreshToken('x', '{}', '{}', 'Token expired')],
    ['a processing timeout', new ProcessingTimeout('instagram')],
  ])('keeps %s as the provider threw it', async (_, error) => {
    await expect(
      new Probe().runInConcurrent(async () => {
        throw error;
      })
    ).rejects.toBe(error);
  });

  it('still classifies a raw error', async () => {
    await expect(
      new Probe().runInConcurrent(async () => {
        throw new Error('socket hang up');
      })
    ).rejects.toThrow('Unknown Error');
  });
});

// Upstream 19996da7c: a revoked bot token made every Discord post ask the
// customer to reconnect, which cannot help.
describe('Discord bot token rejected', () => {
  it('fails the post without asking for a reconnect', () => {
    expect(
      new DiscordProvider().handleErrors('{"message":"401: Unauthorized","code":0}')
    ).toEqual({
      type: 'bad-body',
      value: expect.stringMatching(/Reconnecting the channel will not help/),
    });
  });
});

// Upstream 10bb71da6: the MCP's AI never filled Facebook's `url`, so links
// in the text got no preview card.
describe('Facebook url in the MCP schema', () => {
  it('describes what the link is for', () => {
    void FacebookDto;
    const schema = validationMetadatasToSchemas()['FacebookDto'] as {
      properties: Record<string, { description?: string }>;
    };
    expect(schema.properties.url.description).toMatch(/preview card/);
  });
});
