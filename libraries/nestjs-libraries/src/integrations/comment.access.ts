import { Integration } from '@prisma/client';
import { SocialProvider } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

interface Store {
  getIntegrationById(
    org: string,
    id: string
  ): Promise<Pick<Integration, 'customInstanceDetails'> | null | undefined>;
  replaceCommentAccess(
    org: string,
    id: string,
    expected: string | null,
    next: string
  ): Promise<{ count: number }>;
}

// Before a comment of a provider whose comments use an access of their own
// (TikTok): read it as stored now, not as the workflow read it when it
// started, and renew it when it is about to run out. Two posts of one channel
// can get here together, or the owner can authorize again meanwhile, so the
// renewed access is written only over the value that was read; when someone
// else wrote first, theirs is the one to use, also when their renewal is the
// reason ours was refused.
export const commentAccessForNow = async (
  store: Store,
  provider: Pick<SocialProvider, 'refreshCommentAccess'>,
  integration: Integration
) => {
  if (!provider.refreshCommentAccess) {
    return;
  }
  const read = async () =>
    (await store.getIntegrationById(integration.organizationId, integration.id))
      ?.customInstanceDetails ?? null;

  const stored = await read();
  integration.customInstanceDetails = stored;

  let renewed: string | undefined;
  try {
    renewed = await provider.refreshCommentAccess(integration);
  } catch (err) {
    // A platform that rotates refresh tokens (TikTok, from 2026-12-01) makes
    // the old one invalid the moment it is used. When two comments of one
    // channel renew together, the slower one is refused with the token the
    // faster one has just replaced: the access stored by now is the good one.
    // Refused with nothing new stored, the failure is real.
    const now = await read();
    if (now === stored) {
      throw err;
    }
    integration.customInstanceDetails = now;
    return;
  }
  if (!renewed) {
    return;
  }
  const { count } = await store.replaceCommentAccess(
    integration.organizationId,
    integration.id,
    stored,
    renewed
  );
  integration.customInstanceDetails = count > 0 ? renewed : await read();
};
