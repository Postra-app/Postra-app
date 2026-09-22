import {
  IsDefined,
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail } from './email.transform';
import { Provider } from '@prisma/client';

export class LoginUserDto {
  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
  @MinLength(3)
  // Registration and password reset both cap the password at 64; signing in did
  // not, so every attempt could carry a body up to the global 25 MB JSON limit
  // and be parsed before anything rejected it. bcrypt stops reading at 72 bytes
  // anyway, so nothing longer can be a real password (E2E-10-06).
  @MaxLength(64)
  password: string;

  @IsString()
  @IsDefined()
  provider: Provider;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.password)
  providerToken: string;

  @NormalizeEmail()
  @IsEmail()
  @IsDefined()
  email: string;

  @IsOptional()
  @IsString()
  datafast_visitor_id: string;
}
