import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Transform } from 'class-transformer';

// GET /public/v1/media. page used to reach Prisma unchecked: "0" or "abc"
// became a negative or NaN skip and a 500 (upstream 063ee509).
export class GetMediaDto {
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @IsString()
  search?: string;
}
