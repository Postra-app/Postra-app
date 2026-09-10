import { readFileSync } from 'fs';
import { join } from 'path';
import { hasAiGeneratedMedia } from '@gitroom/nestjs-libraries/integrations/social/ai.media';
import { PostDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

const post = (media?: unknown[]): PostDetails =>
  ({ id: 'p1', message: 'hi', settings: {}, media } as PostDetails);

describe('hasAiGeneratedMedia', () => {
  it('is true when any attachment came from a model', () => {
    expect(
      hasAiGeneratedMedia(
        post([
          { type: 'image', path: 'a.png' },
          { type: 'image', path: 'b.png', aiGenerated: true },
        ])
      )
    ).toBe(true);
  });

  it('is false for a post of the user\'s own files', () => {
    expect(
      hasAiGeneratedMedia(
        post([
          { type: 'image', path: 'a.png', aiGenerated: false },
          { type: 'image', path: 'b.png' },
        ])
      )
    ).toBe(false);
  });

  it('is false for a text-only post', () => {
    expect(hasAiGeneratedMedia(post([]))).toBe(false);
    expect(hasAiGeneratedMedia(post(undefined))).toBe(false);
  });
});

// Both platforms require the declaration, and neither can detect it: our
// renderers strip the C2PA marker the model embeds. Read as source — the
// providers pull the whole integration manager into a test run.
const provider = (name: string) =>
  readFileSync(join(__dirname, name), 'utf8');

describe('platforms that must be told about synthetic media', () => {
  it('YouTube declares it in the video status', () => {
    const source = provider('youtube.provider.ts');
    expect(source).toContain('containsSyntheticMedia');
    expect(source).toContain('hasAiGeneratedMedia(firstPost)');
  });

  it("TikTok keeps the user's switch and adds what we know", () => {
    const source = provider('tiktok.provider.ts');
    expect(source).toMatch(
      /is_aigc:\s*\n?\s*firstPost\.settings\.video_made_with_ai\s*\|\|\s*\n?\s*hasAiGeneratedMedia\(firstPost\)/
    );
  });
});
