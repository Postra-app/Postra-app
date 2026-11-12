import {
  IsDefined,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  BrandKitDto,
  POST_DESIGN_PLATFORMS,
  PostDesignPlatform,
} from './generate.post.design.dto';

export class GeneratePostCarouselDto {
  // With a link the article is the brief and the prompt is an optional note.
  // Only an absent note is let through: `false` or `0` is a wrong type and
  // gets the 400 any other wrong type gets.
  @ValidateIf((o) => !o.sourceUrl || (o.prompt ?? '') !== '')
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
