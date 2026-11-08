import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';
import { aiCooldownMessage } from '@gitroom/nestjs-libraries/services/ai.cooldown';

@Injectable()
export class AccountAgeGuard implements CanActivate {
  constructor(private readonly _usersService: UsersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;
    if (!userId) return false;

    // The hour stops a fresh signup from spending AI before anyone has paid.
    // An organization on a paid, comped or lifetime plan already has; only a
    // trial still waits.
    const org = request.org;
    if (org?.subscription && !org.subscription.deletedAt && !org.isTrailing) {
      return true;
    }

    const user = await this._usersService.getUserById(userId);
    if (!user) return false;

    const refusal = aiCooldownMessage(user.createdAt);
    if (refusal) {
      throw new HttpException(refusal, HttpStatus.FORBIDDEN);
    }

    return true;
  }
}
