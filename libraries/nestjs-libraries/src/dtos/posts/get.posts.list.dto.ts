import {
  IsOptional,
  IsString,
  IsNumber,
  Min,
  Max,
  IsIn,
  IsArray,
  ArrayMaxSize,
} from 'class-validator';
import { Transform } from 'class-transformer';

export type PostListStateFilter =
  | 'all'
  | 'scheduled'
  | 'draft'
  | 'published'
  | 'error';

export class GetPostsListDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Transform(({ value }) => parseInt(value, 10))
  page?: number = 0;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => parseInt(value, 10))
  limit?: number = 20;

  @IsOptional()
  @IsString()
  customer?: string;

  // Channel ids, comma-separated: the list view paginates on the server, so
  // the calendar's channel filter has to apply here (upstream 2a2c85c4).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value : String(value || '').split(',').filter(Boolean)
  )
  integrations?: string[];

  @IsOptional()
  @IsIn(['all', 'scheduled', 'draft', 'published', 'error'])
  state?: PostListStateFilter = 'all';
}
