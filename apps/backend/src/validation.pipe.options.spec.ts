import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';
import { validationPipeOptions } from './validation.pipe.options';

// The global pipe strips what a DTO does not declare,
// nested objects included, so a spread of the body cannot write a field the
// client chose (mass assignment). Nothing tested the pipe itself.
describe('global ValidationPipe', () => {
  const pipe = new ValidationPipe(validationPipeOptions);
  const run = (value: unknown) =>
    pipe.transform(value, { type: 'body', metatype: UserDetailDto });

  it('drops properties the DTO does not declare, at every level', async () => {
    const body = (await run({
      fullname: 'Kris',
      bio: 'hi',
      isSuperAdmin: true,
      tokenVersion: 0,
      picture: { id: 'm1', path: 'https://cdn.example/a.png', organizationId: 'other-org' },
    })) as Record<string, unknown>;
    expect(body).toBeInstanceOf(UserDetailDto);
    expect(body).not.toHaveProperty('isSuperAdmin');
    expect(body).not.toHaveProperty('tokenVersion');
    expect(body.picture).not.toHaveProperty('organizationId');
    expect(body).toMatchObject({ fullname: 'Kris', bio: 'hi', picture: { id: 'm1' } });
  });

  it('still refuses a body that breaks the DTO', async () => {
    await expect(run({ fullname: 'K' })).rejects.toThrow();
  });
});
