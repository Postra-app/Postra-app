import {
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Every signed-in session fetches the announcement banner, so whatever is
 * written here is served to everyone until it is deleted. The lengths were
 * unbounded, which made a mis-paste a payload on every page load (E2E-09-45).
 */
export class AnnouncementDto {
  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsDefined()
  @MinLength(1)
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsString()
  @IsIn(['INFO', 'WARNING', 'ERROR'])
  color?: string;
}
