'use client';

import { FC, useCallback } from 'react';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import {
  hasMetaChecklist,
  MetaConnectChecklist,
} from '@gitroom/frontend/components/launches/meta.connect.checklist';

/**
 * The client end of an invite link. Whoever opens this has never seen Postra —
 * they were sent a link by the agency or freelancer who manages their channels —
 * so this is the only chance to tell them what the platform expects before the
 * platform refuses them without explanation.
 */
export const ConnectInviteClient: FC<{
  provider: string;
  providerName: string;
  token: string;
}> = ({ provider, providerName, token }) => {
  const t = useT();
  const { backendUrl } = useVariables();
  // Through the backend, not straight to the provider: that hop marks this
  // browser as the one the invite was opened in, which is what lets the
  // callback finish without a Postra account.
  const go = useCallback(() => {
    window.location.href = `${backendUrl}/integrations/invite/${encodeURIComponent(
      token
    )}/go?provider=${encodeURIComponent(provider)}`;
  }, [backendUrl, token, provider]);

  if (hasMetaChecklist(provider)) {
    return <MetaConnectChecklist provider={provider} onConfirm={go} />;
  }

  return (
    <div className="flex flex-col gap-[16px] pt-[8px]">
      <p className="text-[14px] text-textColor/80">
        {t(
          'connect_invite_generic',
          'You are about to sign in to {{provider}} so this channel can be managed from Postra. You can disconnect it at any time from the platform itself.',
          { provider: providerName }
        )}
      </p>
      <Button type="button" onClick={go}>
        {t('connect_invite_continue', 'Continue to {{provider}}', {
          provider: providerName,
        })}
      </Button>
    </div>
  );
};
