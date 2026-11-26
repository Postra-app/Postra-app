import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
} from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import {
  TRIAL_AI_ACTIONS_PER_DAY,
  trialAiActionsMessage,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Counts one use for a trialing organisation and says whether it is within
// `limit` for the UTC day. Always true for a paid plan, which is not counted.
export const withinTrialDay = async (
  org: { id?: string; isTrailing?: boolean } | undefined,
  kind: 'ai' | 'autocomplete',
  limit: number
): Promise<boolean> => {
  if (!org?.id || !org.isTrailing) {
    return true;
  }
  const key = `trial-${kind}:${org.id}:${new Date().toISOString().slice(0, 10)}`;
  const used = await ioRedis.incr(key);
  if (used === 1) {
    await ioRedis.expire(key, 2 * 86400);
  }
  return used <= limit;
};

// A trial's daily AI actions on the routes that draw on no allowance (see
// TRIAL_AI_ACTIONS_PER_DAY). Counted per organisation and UTC day in Redis;
// an action is counted when it is asked for. A paid plan is not counted.
// The refusal is a 402 with `trial: true`, which the app shows as the trial's
// limit with "End the trial now".
@Injectable()
export class TrialAiDailyGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const org = context.switchToHttp().getRequest()?.org;
    if (!(await withinTrialDay(org, 'ai', TRIAL_AI_ACTIONS_PER_DAY))) {
      throw new HttpException(
        { statusCode: 402, trial: true, message: trialAiActionsMessage() },
        402
      );
    }
    return true;
  }
}
