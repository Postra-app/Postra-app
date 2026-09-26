/** E2E-05-16 — an empty comment was stored and a missing one was a 500. */
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.comment.dto';

const errors = async (body: any) =>
  (await validate(plainToInstance(CreateCommentDto, body))).length;

describe('CreateCommentDto', () => {
  it('accepts a normal comment', async () => {
    expect(await errors({ comment: 'Looks good, ship it' })).toBe(0);
  });

  it.each([{}, { comment: '' }, { comment: '   ' }, { comment: 42 }, { comment: 'a'.repeat(5001) }])(
    'refuses %p',
    async (body) => {
      expect(await errors(body)).toBeGreaterThan(0);
    }
  );
});
