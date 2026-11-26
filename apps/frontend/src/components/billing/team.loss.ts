import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

// Whether a change of plan disables team members: the new plan seats fewer
// people than the current one. Never during a trial, which is for one person
// whatever the plan, so there is nobody to disable.
export const losesTeamMembers = (
  isTrailing: boolean,
  current: string | undefined,
  next: string
) =>
  !isTrailing &&
  (pricing[next as keyof typeof pricing]?.team_members ?? 0) <
    (pricing[current as keyof typeof pricing]?.team_members ?? 0);
