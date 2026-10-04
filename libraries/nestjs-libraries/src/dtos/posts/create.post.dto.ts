import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsDefined,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Validate,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  allProviders,
  type AllProvidersSettings,
  EmptySettings,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/all.providers.settings';
import { ValidContent } from '@gitroom/helpers/utils/valid.images';
import { sanitizePostContent } from '@gitroom/helpers/utils/sanitize.post.content';

export class Integration {
  @IsDefined()
  @IsString()
  id: string;
}

export class PostContent {
  @IsDefined()
  @IsString()
  @Validate(ValidContent)
  @Transform(({ value }) => sanitizePostContent(value))
  content: string;

  @IsOptional()
  @IsString()
  id: string;

  @IsOptional()
  @IsNumber()
  delay: number;

  // Each image is fetched + sharp-decoded on publish; an unbounded array on a
  // 25mb body could queue thousands of concurrent fetch/decode ops. No platform
  // accepts more than ~10 media per post, so 20 is generous headroom.
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => MediaDto)
  @ValidateNested({ each: true })
  image: MediaDto[];
}

export class Post {
  // Mirrors CreatePostDto.type on each group entry; the @ValidateIf below
  // reads it to skip settings validation for drafts. Must stay decorated or
  // ValidationPipe's whitelist strips it before the condition runs (AE7).
  @IsOptional()
  @IsString()
  type?: string;

  @IsDefined()
  @Type(() => Integration)
  @ValidateNested()
  integration: Integration;

  // One entry per part of a thread/carousel. Long threads are legitimate, so
  // the cap is high — it only exists to stop an unbounded payload.
  @IsDefined()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsArray()
  @Type(() => PostContent)
  @ValidateNested({ each: true })
  value: PostContent[];

  @IsOptional()
  @IsString()
  group: string;

  @ValidateIf((o) => o.type !== 'draft')
  @ValidateNested()
  @Type(() => EmptySettings, {
    keepDiscriminatorProperty: true,
    discriminator: {
      property: '__type',
      subTypes: allProviders(EmptySettings),
    },
  })
  settings: AllProvidersSettings;
}

class Tags {
  @IsDefined()
  @IsString()
  value: string;

  @IsDefined()
  @IsString()
  label: string;
}

export class CreatePostDto {
  @IsDefined()
  @IsIn(['draft', 'schedule', 'now', 'update'])
  type: 'draft' | 'schedule' | 'now' | 'update';

  @IsOptional()
  @IsString()
  order?: string;

  @IsDefined()
  @IsBoolean()
  shortLink: boolean;

  @IsOptional()
  @IsNumber()
  inter?: number;

  // Explicit opt-in to publish an already published post again; without it a
  // "now"/"schedule" save of a published post is refused.
  @IsOptional()
  @IsBoolean()
  republish?: boolean;

  @IsDefined()
  @IsDateString()
  date: string;

  @IsArray()
  @IsDefined()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  tags: Tags[];

  // One post per selected channel in the group; Business tops out at 10
  // channels, so 50 is well clear of any real fan-out.
  @IsDefined()
  @Type(() => Post)
  @IsArray()
  @ValidateNested({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  posts: Post[];
}
