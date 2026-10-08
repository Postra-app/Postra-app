import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

// Dynamic Client Registration (RFC 7591) for MCP clients such as Claude and
// ChatGPT (upstream eabac3d3d). The addresses are checked against an
// allowlist in OAuthService, not here, to answer with the RFC's error.
export class RegisterClientDto {
  @IsDefined()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(2000, { each: true })
  redirect_uris: string[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  client_name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['none', 'client_secret_post'])
  token_endpoint_auth_method?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  grant_types?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  response_types?: string[];

  @IsOptional()
  @IsString()
  client_uri?: string;

  @IsOptional()
  @IsString()
  logo_uri?: string;

  @IsOptional()
  @IsString()
  scope?: string;
}
