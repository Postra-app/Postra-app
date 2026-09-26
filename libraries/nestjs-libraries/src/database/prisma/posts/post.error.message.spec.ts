/**
 * E2E-05-10 — GET /posts/:id returned Post.error verbatim: kilobytes of
 * Temporal JSON with stack traces and container paths. Shapes below are the
 * real rows from production posts cmuijpf77… (Mastodon) and cmuijpf4j… (Telegram).
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { readablePostError } from '@gitroom/nestjs-libraries/database/prisma/posts/post.error.message';

const mastodon = JSON.stringify({
  cause: {
    failure: {
      message: 'Unknown Error',
      source: 'TypeScriptSDK',
      stackTrace: 'ApplicationFailure: Unknown Error\n    at MastodonProvider.fetch (/app/libraries/x.ts:291:11)',
    },
    type: 'bad_body',
    nonRetryable: true,
    details: [
      { identifier: '', json: '{"error":"Cannot attach more than four files"}', body: '{}' },
    ],
  },
  failure: { message: 'Activity task failed' },
  activityType: 'postSocial',
  identity: '280@46ad7c27c762',
});

const telegram = JSON.stringify({
  cause: {
    failure: {
      message: 'ETELEGRAM: 400 Bad Request: message caption is too long',
      stackTrace: 'Error: ETELEGRAM...\n    at /app/node_modules/node-telegram-bot-api/src/telegram.js:316:15',
    },
    type: 'TelegramError',
    nonRetryable: false,
    details: [],
  },
  failure: { message: 'Activity task failed' },
});

describe('readablePostError', () => {
  it('uses the platform reason when the failure kept it', () => {
    expect(readablePostError(mastodon)).toBe('Cannot attach more than four files');
  });

  it('falls back to the failure message', () => {
    expect(readablePostError(telegram)).toBe(
      'ETELEGRAM: 400 Bad Request: message caption is too long'
    );
  });

  it('never returns traces, paths or the worker identity', () => {
    for (const raw of [mastodon, telegram]) {
      const out = readablePostError(raw)!;
      expect(out).not.toMatch(/stackTrace|\/app\/|46ad7c27c762|\n/);
      expect(out.length).toBeLessThanOrEqual(300);
    }
  });

  it('keeps plain-text errors, first line only, secrets masked', () => {
    expect(readablePostError('Channel disabled')).toBe('Channel disabled');
    expect(readablePostError('bad token=abc\n  at x')).toBe('bad token=***');
  });

  it('is null for no error', () => {
    expect(readablePostError(null)).toBeNull();
    expect(readablePostError('')).toBeNull();
  });
});

describe('PostsService.getPost — what the editor receives', () => {
  it('sends the sentence, not the Temporal JSON, and no integration token', async () => {
    const service = Object.create(PostsService.prototype) as PostsService;
    jest.spyOn(service, 'getPostsRecursively').mockResolvedValue([
      {
        id: 'p1',
        group: 'g1',
        image: '[]',
        settings: '{}',
        integrationId: 'i1',
        error: mastodon,
        integration: { id: 'i1', picture: 'x', token: 't', refreshToken: 'r' },
      },
    ] as any);
    jest.spyOn(service, 'updateMedia').mockResolvedValue([] as any);

    const out = await service.getPost('org-1', 'p1');
    expect(out.posts[0].error).toBe('Cannot attach more than four files');
    expect(out.posts[0].integration).not.toHaveProperty('token');
    expect(JSON.stringify(out)).not.toContain('stackTrace');
  });
});
