import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterPushTokenDto {
  // An Expo push token, "ExponentPushToken[...]".
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  token: string;

  @IsOptional()
  @IsIn(['ios', 'android', 'web', 'unknown'])
  platform?: string;

  // The app's per-install secret from the device keychain (E2E-11-365).
  // Older builds send none.
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(256)
  deviceSecret?: string;
}

export class RemovePushTokenDto {
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  token: string;
}
