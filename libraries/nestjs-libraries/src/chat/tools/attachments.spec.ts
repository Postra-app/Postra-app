// Importing the real services drags integration.manager → nostr-tools (ESM).
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service',
  () => ({ IntegrationService: class {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/posts/posts.service',
  () => ({
    PostsService: class {},
  })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);

import { toMedia } from './integration.schedule.post';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

// Upstream b318a6a5a + c1f824ce0 (24 X 2026): an agent could attach media
// only as URL strings, so it could not set alt text, a video cover or the
// cover frame, which the public API and the composer already take.
describe('agent attachments', () => {
  it('a string stays a plain path, an object keeps the per-media fields', () => {
    expect(toMedia('https://cdn.example/a.png')).toEqual({
      path: 'https://cdn.example/a.png',
    });
    expect(
      toMedia({
        path: 'https://cdn.example/v.mp4',
        alt: 'Our shop',
        thumbnail: 'https://cdn.example/c.jpg',
        thumbnailTimestamp: 1500,
      })
    ).toEqual({
      path: 'https://cdn.example/v.mp4',
      alt: 'Our shop',
      thumbnail: 'https://cdn.example/c.jpg',
      thumbnailTimestamp: 1500,
    });
  });

  it('the public API takes the cover frame too, and rejects a negative one', async () => {
    const good = plainToInstance(MediaDto, {
      id: 'm1',
      path: 'https://cdn.example/v.mp4',
      thumbnailTimestamp: 1500,
    });
    const bad = plainToInstance(MediaDto, {
      id: 'm1',
      path: 'https://cdn.example/v.mp4',
      thumbnailTimestamp: -1,
    });
    expect((await validate(good)).map((e) => e.property)).not.toContain(
      'thumbnailTimestamp'
    );
    expect((await validate(bad)).map((e) => e.property)).toContain(
      'thumbnailTimestamp'
    );
  });
});
