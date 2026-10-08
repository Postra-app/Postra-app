import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';

// GET /public/v1/media. page used to reach Prisma unchecked: "0" or "abc"
// became a negative or NaN skip and a 500 (upstream 063ee509). The ceiling
// keeps (page - 1) * 18 a valid skip: 1e308 passed IsInt and overflowed it.
export const MAX_MEDIA_PAGE = 100_000;
export class GetMediaDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(MAX_MEDIA_PAGE)
  page?: number = 1;

  @IsOptional()
  @IsString()
  search?: string;
}
