import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

export class TiktokCommentsConnectDto {
  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  code: string;

  @IsDefined()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  state: string;
}
