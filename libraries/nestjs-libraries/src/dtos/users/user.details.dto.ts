import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';
import {
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UserDetailDto {
  @IsString()
  @MinLength(3)
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
