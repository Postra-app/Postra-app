import { IsIn } from 'class-validator';
import {
  COMPABLE_TIERS,
  CompableTier,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

/**
 * The body of the superadmin "put this org on a plan without a payment" call.
 *
 * It used to be an inline `{ subscription: string }` type, which the global
 * validation pipe cannot see: an inline type carries no metadata, so
 * `whitelist: true` had nothing to whitelist and the string went straight into
 * a `pricing[...]` lookup (E2E-09-40).
 */
export class BillingAddSubscriptionDto {
  @IsIn(COMPABLE_TIERS as unknown as string[])
  subscription: CompableTier;
}
