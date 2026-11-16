import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Validate,
  ValidateIf,
} from 'class-validator';
import { ValidUrlPath } from '@gitroom/helpers/utils/valid.url.path';

export class SaveMediaInformationDto {
  @IsString()
  id: string;

  @IsString()
  alt: string;

  // A frame of the video, stored by us. Any URL was taken: the sweep that
  // removes a deleted file's thumbnail deleted whatever object it named.
  @IsUrl()
  @Validate(ValidUrlPath)
  @ValidateIf((o) => !!o.thumbnail)
  thumbnail: string;

  @IsNumber()
  @ValidateIf((o) => !!o.thumbnailTimestamp)
  thumbnailTimestamp: number;
}
