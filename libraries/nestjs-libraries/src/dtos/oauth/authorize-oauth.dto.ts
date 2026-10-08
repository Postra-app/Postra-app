import { IsDefined, IsIn, IsOptional, IsString, Matches } from 'class-validator';

// PKCE (RFC 7636). BASE64URL(SHA256(code_verifier)) is always 43 characters.
// Only S256 is offered: `plain` would put the verifier itself in the URL.
const S256_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export class AuthorizeOAuthQueryDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsDefined()
  @IsIn(['code'])
  response_type: string;

  @IsString()
  @IsOptional()
  state?: string;

  // Required for a dynamic client (checked in OAuthService): one of the
  // addresses it registered.
  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  @Matches(S256_CHALLENGE, { message: 'code_challenge must be an S256 hash' })
  code_challenge?: string;

  @IsString()
  @IsOptional()
  @IsIn(['S256'], { message: 'code_challenge_method must be S256' })
  code_challenge_method?: string;
}

export class ApproveOAuthDto {
  @IsString()
  @IsDefined()
  client_id: string;

  @IsString()
  @IsOptional()
  state?: string;

  @IsString()
  @IsDefined()
  @IsIn(['approve', 'deny'])
  action: 'approve' | 'deny';

  // Required for a dynamic client (checked in OAuthService): one of the
  // addresses it registered.
  @IsString()
  @IsOptional()
  redirect_uri?: string;

  @IsString()
  @IsOptional()
  @Matches(S256_CHALLENGE, { message: 'code_challenge must be an S256 hash' })
  code_challenge?: string;

  @IsString()
  @IsOptional()
  @IsIn(['S256'], { message: 'code_challenge_method must be S256' })
  code_challenge_method?: string;
}
