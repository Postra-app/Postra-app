import { IsIn, IsString } from 'class-validator';

// Ownership has its own route (it moves the owner too), so only these two.
export class ChangeTeamRoleDto {
  @IsString()
  @IsIn(['USER', 'ADMIN'])
  role: 'USER' | 'ADMIN';
}
