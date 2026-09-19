import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { GetPostsListDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.list.dto';

/**
 * The state allowlist is the first gate a request meets, and it is where
 * E2E-10-51 stopped: measured on production 2026-09-19,
 *
 *   GET /posts/list?state=error → 400
 *   {"message":["state must be one of the following values:
 *     all, scheduled, draft, published"]}
 *
 * so the mobile agenda had no way to ask for the failed posts even after the
 * repository learned to answer. Both halves ship together or neither works.
 */
const check = (state: string) => {
  const dto = plainToInstance(GetPostsListDto, { state });
  return validateSync(dto).flatMap((e) => Object.keys(e.constraints ?? {}));
};

describe('GetPostsListDto state allowlist', () => {
  it('accepts error', () => {
    expect(check('error')).toEqual([]);
  });

  it.each(['all', 'scheduled', 'draft', 'published'])('still accepts %s', (s) => {
    expect(check(s)).toEqual([]);
  });

  it('still rejects anything else', () => {
    expect(check('ERROR')).toContain('isIn');
    expect(check('garbage')).toContain('isIn');
  });
});
