import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrgUserDto } from '@gitroom/nestjs-libraries/dtos/auth/create.org.user.dto';
import { UserDetailDto } from '@gitroom/nestjs-libraries/dtos/users/user.details.dto';

// Short real names were refused: a company called "EY", "BT" or "3", a person
// called "Li". One character is enough; only blank is not.
const signUp = (company: string) =>
  plainToInstance(CreateOrgUserDto, {
    email: 'owner@example.com',
    password: 'a-long-enough-password-1',
    company,
    provider: 'LOCAL',
    termsAccepted: true,
  });

const failsOn = (errors: ReturnType<typeof validateSync>, field: string) =>
  errors.some((e) => e.property === field);

describe('short company and person names', () => {
  it.each(['EY', 'BT', 'O2', '3', 'Li'])('a company may be called %s', (name) => {
    expect(failsOn(validateSync(signUp(name)), 'company')).toBe(false);
  });

  it.each(['', '   '])('a blank company name is refused (%j)', (name) => {
    expect(failsOn(validateSync(signUp(name)), 'company')).toBe(true);
  });

  it.each(['Li', 'Ng', 'X'])('a person may be called %s', (fullname) => {
    const dto = plainToInstance(UserDetailDto, { fullname });
    expect(failsOn(validateSync(dto), 'fullname')).toBe(false);
  });

  it.each(['', '  '])('a blank name is refused (%j)', (fullname) => {
    const dto = plainToInstance(UserDetailDto, { fullname });
    expect(failsOn(validateSync(dto), 'fullname')).toBe(true);
  });
});
