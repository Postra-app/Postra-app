import {
  Equals,
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

// What the app adds to a sign-in to make an account when there is none: the
// workspace name and the consent the person ticked, the same two the web
// sign-up form asks for (CreateOrgUserDto). Without `create` the route signs
// in an existing account only, as it always did.
export class NativeSignUpFields {
  @IsOptional()
  @IsBoolean()
  create?: boolean;

  // One character is a name (BT, EE, O2, "3"); only blank is refused.
  @ValidateIf((o) => o.create === true)
  @IsString()
  @IsDefined()
  @Matches(/\S/, { message: 'company should not be empty' })
  @MaxLength(128)
  company?: string;

  // Explicit ToS/Privacy acceptance (UK GDPR): ticked in the app, not
  // implied by pressing the sign-in button.
  @ValidateIf((o) => o.create === true)
  @Equals(true, {
    message: 'You must accept the Terms of Service and Privacy Policy',
  })
  termsAccepted?: boolean;

  @IsOptional()
  @IsIn(['ios', 'android'])
  platform?: 'ios' | 'android';
}

export class GoogleNativeLoginDto extends NativeSignUpFields {
  // A Google ID token is a signed JWT of about 1–1.5 kB; the cap keeps a
  // request from carrying megabytes to the verifier.
  @IsString()
  @IsDefined()
  @MinLength(20)
  @MaxLength(4096)
  idToken: string;
}

export class AppleNativeLoginDto extends NativeSignUpFields {
  // An Apple identity token is a signed JWT of about 1 kB.
  @IsString()
  @IsDefined()
  @MinLength(20)
  @MaxLength(4096)
  identityToken: string;

  // The random value whose SHA-256 the app put into the request; the token
  // carries the hash (apple.provider.ts).
  @IsString()
  @IsDefined()
  @MinLength(16)
  @MaxLength(256)
  nonce: string;

  // Single-use, valid five minutes; traded for the refresh token that
  // revocation needs.
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  authorizationCode?: string;
}
