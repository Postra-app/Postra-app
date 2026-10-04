import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export class ChangePostStatusDto {
  @IsIn(['draft', 'schedule'])
  status: 'draft' | 'schedule';

  // Required to put an already published post back in the queue.
  @IsOptional()
  @IsBoolean()
  republish?: boolean;
}
