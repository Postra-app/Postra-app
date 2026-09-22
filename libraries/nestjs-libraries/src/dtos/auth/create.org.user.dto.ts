import {
  Equals,
  IsDefined,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { NormalizeEmail } from './email.transform';
import { Provider } from '@prisma/client';

export class CreateOrgUserDto {
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  @IsDefined()
  @ValidateIf((o) => !o.providerToken)
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
  @ValidateIf((o) => !o.providerToken)
  email: string;

  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(128)
  company: string;

  // Explicit ToS/Privacy acceptance (UK GDPR) — must be actively ticked; a
  // passive "by registering you agree" line is not a recordable consent.
  @Equals(true, {
    message: 'You must accept the Terms of Service and Privacy Policy',
  })
  termsAccepted: boolean;

  @IsOptional()
  @IsString()
  datafast_visitor_id: string;

  // Market the signup came from (PL landing vs postra.co.uk). Tags the new
  // Organization so PL/UK can be cleanly split later. Optional; defaults to PL.
  @IsOptional()
  @IsString()
  @IsIn(['PL', 'UK'])
  region?: string;
}
