import { IsDefined, IsEmail, IsString } from 'class-validator';
import { NormalizeEmail } from './email.transform';

export class ForgotPasswordDto {
  @NormalizeEmail()
  @IsString()
  @IsDefined()
  @IsEmail()
  email: string;
}
