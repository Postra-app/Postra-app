import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

// A comment on the shared preview of a post. Rendered as plain text there, so
// no HTML handling — but it did need a shape: an empty body was stored, and a
// missing one reached Prisma as a 500 (E2E-05-16).
export class CreateCommentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  comment: string;
}
