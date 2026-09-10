import {
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const POST_DESIGN_PLATFORMS = [
  'instagram-feed',
  'instagram-square',
  'instagram-story',
  'facebook-feed',
  'linkedin-feed',
  'tiktok-cover',
  'x-post',
] as const;

export type PostDesignPlatform = (typeof POST_DESIGN_PLATFORMS)[number];

export class BrandKitColorsDto {
  @IsString()
  @IsDefined()
  primary: string;

  @IsString()
  @IsDefined()
  secondary: string;

  @IsString()
  @IsDefined()
  text: string;
}

export class BrandKitDto {
  @IsObject()
  @ValidateNested()
  @Type(() => BrandKitColorsDto)
  colors: BrandKitColorsDto;

  @IsString()
  @IsOptional()
  font?: string;

  @IsString()
  @IsOptional()
  tone?: string;

  @IsString()
  @IsOptional()
  logoPath?: string | null;
}

export class GeneratePostDesignDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(500)
  prompt: string;

  @IsString()
  @IsDefined()
  @IsIn(POST_DESIGN_PLATFORMS as unknown as string[])
  platform: PostDesignPlatform;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandKitDto)
  brandKit?: BrandKitDto;

  // Language for the on-image text (headline/subtext/cta). When omitted the
  // generator detects it from the prompt. Set it to keep a draft's design and
  // caption in the same language (see MediaService.createBrandedDraft).
  @IsString()
  @IsOptional()
  @MaxLength(40)
  language?: string;

  // The UI locale. Used only when the prompt is too short to tell what
  // language it is in — an explicit `language` still wins. Studio used to send
  // the locale AS the target, which put English text on a Polish prompt.
  @IsString()
  @IsOptional()
  @MaxLength(40)
  languageFallback?: string;
}
