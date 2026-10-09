import {
  IsArray,
  IsDefined,
  IsNumber,
  IsOptional,
  IsTimeZone,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class IntegrationValidateTimeDto {
  @IsDefined()
  @IsNumber()
  time: number;

  // IANA zone of a local-time slot (E2E-05-85); without it the minutes are
  // after UTC midnight.
  @IsOptional()
  @IsTimeZone()
  tz?: string;
}
export class IntegrationTimeDto {
  @Type(() => IntegrationValidateTimeDto)
  @IsArray()
  @IsDefined()
  @ValidateNested({ each: true })
  time: IntegrationValidateTimeDto[];
}
