import {
  IsDefined,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';

export class ConnectIntegrationDto {
  @IsString()
  @IsDefined()
  state: string;

  // The OAuth code from the platform's redirect. Not sent when the mobile app
  // signed in through the platform's own SDK (sdkToken below).
  @ValidateIf((o: ConnectIntegrationDto) => !o.sdkToken)
  @IsString()
  @IsDefined()
  code: string;

  // A user token from the platform's mobile SDK (Facebook Login), in place of
  // the code. The provider verifies it was issued for our app.
  @IsString()
  @IsOptional()
  @MaxLength(2048)
  sdkToken?: string;

  @IsString()
  @IsDefined()
  timezone: string;

  @IsString()
  @IsOptional()
  refresh?: string;
}
