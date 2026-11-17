'use client';

import React, { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import { isFetchHandledError } from '@gitroom/helpers/utils/fetch.errors';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { CustomVariables } from '@gitroom/frontend/components/launches/add.provider.component';
import { web3List } from '@gitroom/frontend/components/launches/web3/web3.list';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';

type Reconnectable = {
  id: string;
  internalId: string;
  identifier?: string;
  providerIdentifier?: string;
  name?: string;
  customFields?: Array<{
    key: string;
    label: string;
    validation: string;
    defaultValue?: string;
    type: 'text' | 'password';
  }>;
};

/**
 * Reconnecting a channel that needs it, the way Add Channel connects one.
 *
 * Every place sent the browser to whatever `url` came back. For a platform
 * signed in with OAuth that is the platform's page; for Bluesky, WordPress
 * and Telegram it is only a state to carry, so "click to reconnect" opened
 * /MSSIub, a 404, and analytics' "tap to refresh" opened /undefined
 *. Those now open the credentials form or the Telegram
 * steps, with the channel named in `refresh` so the plan's channel limit and
 * the member's role do not stand in the way of fixing a channel the
 * organisation already has.
 */
export const useReconnectChannel = () => {
  const fetch = useFetch();
  const toast = useToaster();
  const t = useT();
  const modal = useModals();
  const router = useRouter();
  const { data: channels } = useIntegrationList();

  return useCallback(
    (integration: Reconnectable) => async () => {
      // The analytics page holds a lighter channel object.
      const known = (channels as Reconnectable[] | undefined)?.find(
        (c) => c.id === integration.id
      );
      const channel = { ...known, ...integration };
      const identifier = channel.identifier || channel.providerIdentifier;
      const failed = (detail?: string) =>
        toast.show(
          `${t('channel_reconnect_failed', 'Could not reconnect the channel')}${
            detail ? `: ${detail}` : ''
          }`,
          'warning'
        );
      if (!identifier || !channel.internalId) {
        failed();
        return;
      }
      if (channel.customFields?.length) {
        modal.openModal({
          title: t('update_credentials', 'Update credentials'),
          withCloseButton: true,
          classNames: { modal: 'launches-modal-surface text-textColor' },
          children: (
            <CustomVariables
              identifier={identifier}
              refresh={channel.internalId}
              gotoUrl={(url: string) => router.push(url)}
              variables={channel.customFields}
            />
          ),
        });
        return;
      }
      try {
        const response = await fetch(
          `/integrations/social/${identifier}?refresh=${encodeURIComponent(
            channel.internalId
          )}`,
          { method: 'GET' }
        );
        if (!response.ok) {
          failed(await readResponseError(response));
          return;
        }
        const { url } = await response.json();
        if (typeof url !== 'string' || !url) {
          failed();
          return;
        }
        const steps = web3List.find((item) => item.identifier === identifier);
        if (steps) {
          const Steps = steps.component;
          modal.openModal({
            title: t('reconnect_channel', 'Reconnect channel'),
            withCloseButton: true,
            classNames: { modal: 'launches-modal-surface text-textColor' },
            children: (
              <Steps
                nonce={url}
                onComplete={(code, state) => {
                  window.location.href = `/integrations/social/${identifier}?code=${code}&state=${state}`;
                }}
              />
            ),
          });
          return;
        }
        // Only a real address: anything else is a state this flow cannot
        // carry, and the browser would open it as a page of ours.
        if (!/^https?:\/\//i.test(url)) {
          failed();
          return;
        }
        window.location.href = url;
      } catch (e) {
        // 403, 429 and 5xx have shown their own toast.
        if (!isFetchHandledError(e)) {
          console.error('[Postra:channels] reconnect failed', e);
          failed();
        }
      }
    },
    [channels, fetch, modal, router, t, toast]
  );
};
