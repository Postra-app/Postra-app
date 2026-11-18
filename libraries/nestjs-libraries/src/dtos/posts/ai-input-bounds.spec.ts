import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SeparatePostsDto } from '@gitroom/nestjs-libraries/dtos/posts/separate.posts.dto';
import { CreateGeneratedPostsDto } from '@gitroom/nestjs-libraries/dtos/generator/create.generated.posts.dto';
import { requireBoundedPrompt } from '@gitroom/backend/api/routes/media.controller';

// Text that goes to a model on our key, or rows written in one request, had
// no upper bound: a 25 MB body to split into a thread, an image prompt of any
// length, any number of drafts at once.
describe('AI inputs and generated drafts are bounded', () => {
  const errors = async (cls: any, body: object) =>
    (await validate(plainToInstance(cls, body))).map((e) => e.property);

  it('splitting a post takes one post, not a document', async () => {
    expect(await errors(SeparatePostsDto, { content: 'hello', len: 280 })).toEqual([]);
    expect(await errors(SeparatePostsDto, { content: 'x'.repeat(50_001), len: 280 })).toEqual(['content']);
    expect(await errors(SeparatePostsDto, { content: 'hello', len: 0 })).toEqual(['len']);
  });

  it('drafts from the generator: a bounded number of posts and parts', async () => {
    const base = { week: 47, year: 2026, url: 'https://example.com', postId: '' };
    const group = { list: [{ post: 'p' }] };
    expect(await errors(CreateGeneratedPostsDto, { ...base, posts: [group] })).toEqual([]);
    expect(
      await errors(CreateGeneratedPostsDto, { ...base, posts: Array.from({ length: 51 }, () => group) })
    ).toEqual(['posts']);
    expect(
      await errors(CreateGeneratedPostsDto, {
        ...base,
        posts: [{ list: Array.from({ length: 101 }, () => ({ post: 'p' })) }],
      })
    ).toEqual(['posts']);
  });

  it('an image prompt is a few paragraphs at most', () => {
    expect(() => requireBoundedPrompt('a red bicycle')).not.toThrow();
    expect(() => requireBoundedPrompt('x'.repeat(4001))).toThrow('up to 4000');
    expect(() => requireBoundedPrompt('')).toThrow();
    expect(() => requireBoundedPrompt({ prompt: 'nested' })).toThrow();
  });
});
