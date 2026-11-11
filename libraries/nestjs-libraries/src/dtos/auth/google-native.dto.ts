import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export class GoogleNativeLoginDto {
  // A Google ID token is a signed JWT of about 1–1.5 kB; the cap keeps a
  // request from carrying megabytes to the verifier.
  @IsString()
  @IsDefined()
  @MinLength(20)
  @MaxLength(4096)
  idToken: string;
}
