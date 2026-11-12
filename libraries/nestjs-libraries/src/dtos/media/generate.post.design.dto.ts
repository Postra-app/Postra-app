import {
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  DESIGN_FORMAT_KEYS,
  DesignFormatKey,
} from '@gitroom/nestjs-libraries/studio/design-formats';

export const POST_DESIGN_PLATFORMS = DESIGN_FORMAT_KEYS;

export type PostDesignPlatform = DesignFormatKey;

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
  // With a link the article is the brief and the prompt is an optional note.
  @ValidateIf((o) => !o.sourceUrl || !!o.prompt)
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(500)
  prompt: string;

  // A public article to build the design from (Studio "From a link"). The
  // server reads it through the SSRF-pinned dispatcher; see article.reader.ts.
  @IsOptional()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(2000)
  sourceUrl?: string;

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
