import { IsDefined, IsOptional, IsString, Matches } from 'class-validator';

export class TokenExchangeDto {
  @IsString()
  @IsDefined()
  grant_type: string;

  @IsString()
  @IsDefined()
  code: string;

  @IsString()
  @IsDefined()
  client_id: string;

  // A public client (a connector registered with
  // token_endpoint_auth_method "none") has no secret and uses PKCE.
  @IsString()
  @IsOptional()
  client_secret?: string;

  @IsString()
  @IsOptional()
  redirect_uri?: string;

  // RFC 7636 §4.1: 43–128 unreserved characters.
  @IsString()
  @IsOptional()
  @Matches(/^[A-Za-z0-9._~-]{43,128}$/, {
    message: 'code_verifier must be 43-128 unreserved characters',
  })
  code_verifier?: string;
}
