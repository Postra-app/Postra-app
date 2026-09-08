import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RefineDesignDto {
  @IsObject()
  @IsDefined()
  spec: unknown;

  @IsString()
  @IsDefined()
  @MinLength(2)
  @MaxLength(500)
  instruction: string;

  @IsString()
  @IsOptional()
  @MaxLength(2_000_000)
  screenshot?: string;
}

export class BrandVoiceCheckDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(3000)
  caption: string;
}

const AI_EDIT_ACTIONS = [
  'improve',
  'shorten',
  'expand',
  'adapt',
  'fix_tone',
] as const;

export class SuggestHashtagsDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(3000)
  text: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  platform?: string;
}

export class AiEditTextDto {
  @IsString()
  @IsDefined()
  @MinLength(3)
  @MaxLength(3000)
  text: string;

  @IsString()
  @IsDefined()
  @IsIn(AI_EDIT_ACTIONS as unknown as string[])
  action: string;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  platform?: string;
}

// Studio persistence. Both bodies were previously typed as inline object
// literals, so the global ValidationPipe skipped them and only the 25 MB
// byte-cap applied. These DTOs give the pipe a class to validate; the
// canvas-JSON shape (Fabric) and spec shape (StudioSpec) are checked in the
// service where the parsed value is available.
export class SaveCanvasJsonDto {
  @IsString()
  @IsDefined()
  // Fabric toJSON() for a busy canvas is large but bounded well under the
  // 25 MB body cap; 24M chars keeps a little headroom.
  @MaxLength(24_000_000)
  canvasJson: string;
}

export class SaveDesignSpecDto {
  @IsObject()
  @IsDefined()
  spec: unknown;
}

export class TemplateSearchEntryDto {
  @IsString()
  id: string;

  @IsString()
  @MaxLength(500)
  text: string;
}

export class TemplateSearchDto {
  @IsString()
  @IsDefined()
  @MinLength(2)
  @MaxLength(200)
  query: string;

  @IsArray()
  @ArrayMaxSize(200)
  templates: TemplateSearchEntryDto[];
}
