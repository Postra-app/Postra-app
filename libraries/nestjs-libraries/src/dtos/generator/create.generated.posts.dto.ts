import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsNumber,
  IsString,
  MaxLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// Drafts are saved as posts in one request: bounded like a post, so one
// request cannot write an unbounded number of rows.
class InnerPost {
  @IsString()
  @IsDefined()
  @MaxLength(50_000)
  post: string;
}

class PostGroup {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InnerPost)
  @IsDefined()
  list: InnerPost[];
}

export class CreateGeneratedPostsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PostGroup)
  @IsDefined()
  posts: PostGroup[];

  @IsNumber()
  @IsDefined()
  week: number;

  @IsNumber()
  @IsDefined()
  year: number;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.url)
  url: string;

  @IsString()
  @IsDefined()
  @ValidateIf((o) => !o.url)
  postId: string;
}
