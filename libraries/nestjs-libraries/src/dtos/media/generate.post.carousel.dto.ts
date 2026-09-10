import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BrandKitDto,
  POST_DESIGN_PLATFORMS,
  PostDesignPlatform,
} from './generate.post.design.dto';

export class GeneratePostCarouselDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(500)
  prompt: string;

  @IsString()
  @IsDefined()
  @IsIn(POST_DESIGN_PLATFORMS as unknown as string[])
  platform: PostDesignPlatform;

  @IsInt()
  @Min(2)
  @Max(10)
  slidesCount: number;

  @IsObject()
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandKitDto)
  brandKit?: BrandKitDto;

  // Language for the on-slide text (headline/subtext/cta). When omitted the
  // generator detects it from the prompt — a brand kit written in another
  // language can tip that detection, so UI callers pass it explicitly.
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
