import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useRouter, useSearchParams } from 'next/navigation';
import { TopTitle } from '@gitroom/frontend/components/launches/helpers/top.title.component';
import { IntegrationContext } from '@gitroom/frontend/components/launches/helpers/use.integration';
import dayjs from 'dayjs';
import { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { continueProviderList } from '@gitroom/frontend/components/new-launch/providers/continue-provider/list';
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
export const Null: FC<{
  onSave: (data: any) => Promise<void>;
}> = () => null;
export const ContinueProvider: FC = () => {
  const { mutate } = useSWRConfig();
  const searchParams = useSearchParams();
  const added = searchParams.get('added');
  const continueId = searchParams.get('continue');
  const router = useRouter();
  const refreshList = useCallback(() => {
    mutate('/integrations/list');
    const url = new URL(window.location.href);
    url.searchParams.delete('added');
    url.searchParams.delete('continue');
    router.push(url.toString());
  }, []);
  const Provider = useMemo(() => {
    if (!added) {
      return Null;
    }
    return (
      continueProviderList[added as keyof typeof continueProviderList] || Null
    );
  }, [added]);

  if (!added || !continueId) {
    return null;
  }

  return (
    <ContinueModal
      refreshList={refreshList}
      added={added}
      continueId={continueId}
      provider={Provider}
    />
  );
};

const ModalContent: FC<{
  continueId: string;
  added: any;
  provider: any;
  closeModal: () => void;
}> = ({ continueId, added, provider: Provider, closeModal }) => {
  const fetch = useFetch();
  const t = useT();
  const [saveError, setSaveError] = useState('');

  // The window closed as after a success whatever the server said: a page
  // already connected to another Postra account (409) or a missing
  // permission (400) left the channel half-added, with no word why. It stays
  // open now, with the reason above the list.
  const onSave = useCallback(
    async (data: any) => {
      try {
        const response = await fetch(
          `/integrations/provider/${continueId}/connect`,
          {
            method: 'POST',
            body: JSON.stringify(data),
          }
        );
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setSaveError(
            body?.message ||
              t(
                'channel_configuration_failed',
                'Could not save this choice. Please try again.'
              )
          );
          return;
        }
      } catch {
        // 403, 429, 5xx: the app-wide toast has said why.
        setSaveError(
          t(
            'channel_configuration_failed',
            'Could not save this choice. Please try again.'
          )
        );
        return;
      }
      closeModal();
    },
    [continueId, closeModal, t]
  );

  return (
    <IntegrationContext.Provider
      value={{
        date: newDayjs(),
        value: [],
        allIntegrations: [],
        integration: {
          editor: 'normal',
          additionalSettings: '',
          display: '',
          time: [
            {
              time: 0,
            },
          ],
          id: continueId,
          type: '',
          name: '',
          picture: '',
          inBetweenSteps: true,
          changeNickName: false,
          changeProfilePicture: false,
          identifier: added,
        },
      }}
    >
      {/* Every page the login returned, the connected ones too: with those
          filtered out, a login whose only page was already connected got a
          title over an empty grid and no way on. Choosing a connected page
          renews that channel with this login (upstream #2071). */}
      {!!saveError && (
        <div
          role="alert"
          className="mb-[12px] rounded-[8px] border border-red-500/40 bg-red-500/10 px-[12px] py-[10px] text-[14px] text-red-200"
        >
          {saveError}
        </div>
      )}
      <Provider onSave={onSave} />
    </IntegrationContext.Provider>
  );
};

const ContinueModal: FC<{
  continueId: string;
  added: any;
  provider: any;
  refreshList: () => void;
}> = (props) => {
  const modals = useModals();

  useEffect(() => {
    modals.openModal({
      title: 'Configure Channel',
      children: (close) => (
        <ModalContent
          {...props}
          closeModal={() => {
            props.refreshList();
            close();
          }}
        />
      ),
    });
  }, []);

  return null;
};
