import { IsDefined, IsString, MaxLength } from 'class-validator';

// An empty name puts the platform's own name back.
export class IntegrationNameDto {
  @IsDefined()
  @IsString()
  @MaxLength(100)
  name: string;
}
