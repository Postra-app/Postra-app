import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { LoginUserDto } from './login.user.dto';
import { CreateOrgUserDto } from './create.org.user.dto';
import { ForgotPasswordDto } from './forgot.password.dto';
import { ResendActivationDto } from './resend-activation.dto';
import { UsersRepository } from '../../database/prisma/users/users.repository';

// What the global ValidationPipe does with `transform: true`.
const parse = async <T extends object>(cls: new () => T, body: object) => {
  const dto = plainToInstance(cls, body);
  return { dto, errors: await validate(dto) };
};

describe('email normalisation on auth forms (E2E-03-01)', () => {
  const typed = '  Kris.Test@Example.COM ';

  it('signs in with the address as typed, spaces and capitals included', async () => {
    const { dto, errors } = await parse(LoginUserDto, {
      email: typed,
      password: 'correct horse',
      provider: 'LOCAL',
    });
    expect(errors).toEqual([]);
    expect(dto.email).toBe('kris.test@example.com');
  });

  it('reads the address the same way on every form that takes one', async () => {
    for (const cls of [ForgotPasswordDto, ResendActivationDto]) {
      const { dto, errors } = await parse(cls, { email: typed });
      expect(errors).toEqual([]);
      expect(dto.email).toBe('kris.test@example.com');
    }
    const { dto } = await parse(CreateOrgUserDto, { email: typed });
    expect(dto.email).toBe('kris.test@example.com');
  });

  it('still rejects something that is not an address', async () => {
    const { errors } = await parse(LoginUserDto, {
      email: 'not an email',
      password: 'correct horse',
      provider: 'LOCAL',
    });
    expect(errors.map((e) => e.property)).toContain('email');
  });
});

describe('UsersRepository.getUserByEmail', () => {
  const make = (rows: { email: string }[]) => {
    const findFirst = jest.fn(async ({ where }: any) => {
      const wanted = where.email;
      return (
        rows.find((r) =>
          typeof wanted === 'string'
            ? r.email === wanted
            : r.email.toLowerCase() === wanted.equals.toLowerCase()
        ) ?? null
      );
    });
    const repo = new UsersRepository(
      { model: { user: { findFirst } } } as any,
      {} as any
    );
    return { repo, findFirst };
  };

  it('finds an account stored before emails were lower-cased', async () => {
    const { repo } = make([{ email: 'Kris.Test@Example.com' }]);
    expect(await repo.getUserByEmail('kris.test@example.com')).toEqual({
      email: 'Kris.Test@Example.com',
    });
  });

  it('prefers the exact match and does not ask twice', async () => {
    const { repo, findFirst } = make([{ email: 'kris.test@example.com' }]);
    await repo.getUserByEmail('kris.test@example.com');
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('returns nothing for an address nobody has', async () => {
    const { repo } = make([{ email: 'someone@example.com' }]);
    expect(await repo.getUserByEmail('kris.test@example.com')).toBeNull();
  });
});
