import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

const AI_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

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

    const accountAge = Date.now() - new Date(user.createdAt).getTime();
    if (accountAge < AI_COOLDOWN_MS) {
      const minutesLeft = Math.ceil(
        (AI_COOLDOWN_MS - accountAge) / 60_000
      );
      throw new HttpException(
        `AI tools unlock one hour after signup, in ${minutesLeft} ${
          minutesLeft === 1 ? 'minute' : 'minutes'
        }. Try our templates in the meantime!`,
        HttpStatus.FORBIDDEN
      );
    }

    return true;
  }
}
