'use client';

import { FC, Fragment, useCallback } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Card } from '@gitroom/frontend/components/ui/card';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const useApprovedApps = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    return (await fetch('/user/approved-apps')).json();
  }, []);
  return useSWR('approved-apps', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
  });
};

export const ApprovedAppsComponent: FC = () => {
  const fetch = useFetch();
  const toaster = useToaster();
  const t = useT();
  const { data: apps, mutate } = useApprovedApps();

  const revokeApp = useCallback(
    (app: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_revoke_access',
            `Are you sure you want to revoke access for ${app.oauthApp?.name}?`,
            { name: app.oauthApp?.name }
          )
        )
      ) {
        try {
          await fetch(`/user/approved-apps/${app.id}`, {
            method: 'DELETE',
          });
          toaster.show(
            t('access_revoked', 'Access revoked'),
            'success'
          );
          mutate();
        } catch {
          toaster.show(t('failed_to_revoke', 'Failed to revoke access'), 'warning');
        }
      }
    },
    []
  );

  if (apps === undefined) {
    return null;
  }

  return (
    <div className="flex flex-col gap-[20px]">
      <div className="flex flex-col">
        <h3 className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
          {t('approved_apps', 'Approved apps')}
        </h3>
        <div className="text-[12.5px] text-newTextColor/55 mt-[3px]">
          {t(
            'apps_you_have_authorized',
            'Apps you have authorized to access your Postra account.'
          )}
        </div>
      </div>

      <Card className="p-[24px]">
        {!apps?.length ? (
          <div className="text-newTextColor/55">
            {t('no_approved_apps', 'No approved apps.')}
          </div>
        ) : (
          <div className="flex flex-col gap-[16px]">
            {apps.map((app: any) => (
              <div
                key={app.id}
                className="flex items-center justify-between p-[12px] border border-white/10 rounded-[12px]"
              >
                <div className="flex items-center gap-[12px]">
                  {app.oauthApp?.picture?.path ? (
                    <img
                      src={app.oauthApp.picture.path}
                      alt={app.oauthApp.name}
                      className="w-[40px] h-[40px] rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-[40px] h-[40px] rounded-full bg-fifth flex items-center justify-center text-newTextColor/55">
                      {app.oauthApp?.name?.[0]?.toUpperCase() || '?'}
                    </div>
                  )}
                  <div>
                    <div className="text-[14px] font-bold">
                      {app.oauthApp?.name}
                    </div>
                    {app.oauthApp?.description && (
                      <div className="text-newTextColor/55 text-[12px]">
                        {app.oauthApp.description}
                      </div>
                    )}
                    <div className="text-newTextColor/55 text-[12px]">
                      {t('authorized_on', 'Authorized on')}{' '}
                      {new Date(app.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </div>
                <Button variant="danger" onClick={revokeApp(app)}>
                  {t('revoke', 'Revoke access')}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
