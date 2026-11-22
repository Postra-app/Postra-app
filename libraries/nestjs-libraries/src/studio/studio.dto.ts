import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

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
  'translate',
] as const;

/**
 * The two languages the product ships in. An allowlist rather than free text:
 * the value is read straight into the prompt, and "translate into <anything
 * the caller types>" is an instruction the caller gets to write.
 */
export const AI_EDIT_LANGUAGES = ['en', 'pl'] as const;

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

  // Required for 'translate' and meaningless for the rest: translating into a
  // language nobody asked for is worse than refusing.
  @ValidateIf((body: AiEditTextDto) => body.action === 'translate')
  @IsDefined()
  @IsString()
  @IsIn(AI_EDIT_LANGUAGES as unknown as string[])
  language?: string;
}

export const AI_CHAT_ROLES = ['user', 'assistant'] as const;

export class AiChatMessageDto {
  @IsString()
  @IsDefined()
  @IsIn(AI_CHAT_ROLES as unknown as string[])
  role: 'user' | 'assistant';

  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(6000)
  content: string;
}

// The composer's chat. The browser keeps the conversation and sends it whole,
// so the caps here are what bounds one call: 20 turns, 10 posts.
export class AiChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AiChatMessageDto)
  messages: AiChatMessageDto[];

  // What the composer holds right now, one entry per post of the thread.
  @IsArray()
  @IsOptional()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(5000, { each: true })
  posts?: string[];

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

  // Optional now: the client sends the hash of the catalogue first, and only
  // resends the texts when the server has no embeddings cached under it.
  // Each entry is checked too: `[null]` passed the array check and failed
  // later as a 500, and the 500-character cap on `text` never applied.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => TemplateSearchEntryDto)
  templates?: TemplateSearchEntryDto[];

  @IsOptional()
  @IsString()
  @MaxLength(128)
  corpusHash?: string;
}

export class RetouchDto {
  @IsString()
  @IsDefined()
  @IsIn(['light', 'medium', 'strong', 'bw'])
  level: 'light' | 'medium' | 'strong' | 'bw';
}
