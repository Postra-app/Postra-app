import { IsInt, IsString, Max, MaxLength, Min } from 'class-validator';

// Splitting a post into a thread sends it to a text model on our key: the
// text of one post, not a document.
export class SeparatePostsDto {
  @IsString()
  @MaxLength(50_000)
  content: string;

  // The character limit of one part on the target platform.
  @IsInt()
  @Min(1)
  @Max(100_000)
  len: number;
}
