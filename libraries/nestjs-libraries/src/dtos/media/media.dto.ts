import {
  IsDefined,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
  ValidateIf,
  Validate,
} from 'class-validator';
import {
  ValidUrlExtension,
  ValidUrlPath,
} from '@gitroom/helpers/utils/valid.url.path';

export class MediaDto {
  @IsString()
  @IsDefined()
  id: string;

  @IsString()
  @IsDefined()
  @Validate(ValidUrlPath)
  @Validate(ValidUrlExtension)
  path: string;

  @ValidateIf((o) => o.alt)
  @IsString()
  alt?: string;

  @ValidateIf((o) => o.thumbnail)
  @IsUrl()
  thumbnail?: string;

  // The video frame to use as the cover, in milliseconds (Instagram Reels,
  // TikTok). The global whitelist dropped it silently before 2026-10-24.
  @IsOptional()
  @IsInt()
  @Min(0)
  thumbnailTimestamp?: number;
}
