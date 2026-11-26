import { HttpException } from '@nestjs/common';
import {
  planLabel,
  pricing,
  TRIAL_AI_IMAGES,
} from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

type OrgPlan = {
  isTrailing?: boolean | null;
  subscription?: { subscriptionTier?: string | null } | null;
  // The member asking, on a web session (the request's organisation).
  users?: { role?: string | null }[] | null;
};

// No AI image credits left. A trial is told it is the trial's limit and what
// its plan has, flagged so the app offers "End the trial now"; a paid plan
// keeps the wording it had.
export const noImageCredits = (org?: OrgPlan | null) => {
  if (!org?.isTrailing) {
    return new HttpException(
      'No image generation credits remaining for this billing cycle',
      402
    );
  }
  const tier = org.subscription?.subscriptionTier;
  const paid = tier && tier !== 'FREE' && pricing[tier] ? tier : 'STANDARD';
  return new HttpException(
    {
      statusCode: 402,
      trial: true,
      // Billing is for admins: a plain member is told to ask one, as with the
      // other plan limits (SubscriptionExceptionFilter).
      ...(org.users?.[0]?.role
        ? {
            canManageBillingUi:
              org.users[0].role === 'SUPERADMIN' || org.users[0].role === 'ADMIN',
          }
        : {}),
      message: `Your free trial includes ${TRIAL_AI_IMAGES} AI images. Your ${planLabel(
        paid
      )} plan includes ${pricing[paid].image_generation_count} AI images a month. End the trial to start your plan now.`,
    },
    402
  );
};
