import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UserDetailDto {
  // One character is a name (Li, Ng in two; some people use one); only
  // blank is refused.
  @IsString()
  @Matches(/\S/, { message: 'fullname should not be empty' })
  fullname: string;

  @IsString()
  @IsOptional()
  bio: string;

  // Without @Type the nested object was not a MediaDto, the whitelist emptied
  // it, and a chosen picture reached the database as { id: undefined }
  // (found with the Profile card, 2026-10-10).
  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  picture: MediaDto;
}
