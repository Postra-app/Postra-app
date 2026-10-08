'use client';

import React, { FC, Fragment, useCallback, useState, useRef } from 'react';
import { refusalMessage } from '@gitroom/frontend/components/layout/response.error';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Card } from '@gitroom/frontend/components/ui/card';
import {
  useDecisionModal,
  useModals,
} from '@gitroom/frontend/components/layout/new-modal';
import { CopyButton } from '@gitroom/frontend/components/ui/copy-button';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

export const Webhooks: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();
  const list = useCallback(async () => {
    return (await fetch('/webhooks')).json();
  }, []);
  const { data, mutate } = useSWR('webhooks', list);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data
          ? t('update_webhook', 'Update webhook')
          : t('add_webhook', 'Add webhook'),
        withCloseButton: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    [t]
  );
  const deleteHook = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete',
            `Are you sure you want to delete ${data.name}?`,
            { name: data.name }
          )
        )
      ) {
        await fetch(`/webhooks/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(
          t('webhook_deleted_successfully', 'Webhook deleted successfully'),
          'success'
        );
      }
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
        {t('webhooks', 'Webhooks')} ({data?.length || 0}/{user?.tier?.webhooks})
      </h3>
      <div className="text-[12.5px] text-newTextColor/55 mt-[3px]">
        {t(
          'webhooks_are_a_way_to_get_notified_when_something_happens_in_postra_via_an_http_request',
          'Webhooks are a way to get notified when something happens in Postra via\n        an HTTP request.'
        )}
      </div>
      <Card className="my-[16px] items-center p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[1fr,1fr,1fr,1fr] w-full gap-y-[10px]">
              <div>{t('name', 'Name')}</div>
              <div>{t('url', 'URL')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.name}</div>
                  <div className="flex flex-col justify-center">{p.url}</div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button variant="secondary" onClick={addWebhook(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button variant="danger" onClick={deleteHook(p)}>
                        {t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          <div>
            <Button
              onClick={addWebhook()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_webhook', 'Add a webhook')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
// The secret that signs this webhook's deliveries (Postra-Signature header).
// Read only when asked for: it lets whoever holds it forge a delivery.
const WebhookSecret: FC<{ id: string }> = ({ id }) => {
  const fetch = useFetch();
  const t = useT();
  const toast = useToaster();
  const decision = useDecisionModal();
  const [secret, setSecret] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/webhooks/${id}/secret`);
    if (res.ok) {
      setSecret((await res.json()).secret);
    }
  }, [id]);

  const rotate = useCallback(async () => {
    const approved = await decision.open({
      title: t('webhook_new_secret_title', 'Generate a new signing secret?'),
      description: t(
        'webhook_new_secret_description',
        'Deliveries are signed with the new secret from now on. A receiver that still checks the old one will reject them until you update it.'
      ),
      approveLabel: t('generate', 'Generate'),
      cancelLabel: t('cancel', 'Cancel'),
    });
    if (!approved) return;
    const res = await fetch(`/webhooks/${id}/secret`, { method: 'POST' });
    if (res.ok) {
      setSecret((await res.json()).secret);
      toast.show(
        t('webhook_new_secret_done', 'New signing secret generated'),
        'success'
      );
    }
  }, [id]);

  return (
    <div className="flex flex-col gap-[8px] mt-[16px]">
      <div className="text-[14px] font-[600]">
        {t('webhook_signing_secret', 'Signing secret')}
      </div>
      <div className="text-[12.5px] text-newTextColor/55">
        {t(
          'webhook_signing_secret_note',
          'Every delivery carries a Postra-Signature header made with this secret. Check it on your server to know the request came from Postra (see Help).'
        )}
      </div>
      <div className="bg-white/[0.03] border border-white/10 rounded-[8px] px-[16px] h-[44px] flex items-center overflow-hidden">
        <code className="text-[14px] flex-1 truncate">
          {secret || (
            <span className="blur-sm select-none">
              whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
            </span>
          )}
        </code>
      </div>
      <div className="flex gap-[8px]">
        {secret ? (
          <CopyButton text={secret} label={t('copy', 'Copy')} />
        ) : (
          <Button type="button" variant="secondary" onClick={load}>
            {t('reveal', 'Reveal')}
          </Button>
        )}
        <Button type="button" variant="secondary" onClick={rotate}>
          {t('webhook_new_secret', 'Generate a new secret')}
        </Button>
      </div>
    </div>
  );
};

const details = object().shape({
  name: string().required(),
  url: string().url().required(),
  integrations: array(),
});
const getWebhookOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
  const fetch = useFetch();
  const t = useT();
  const options = getWebhookOptions(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (data?.integrations?.length || 0) > 0 ? options[1] : options[0]
  );
  const modal = useModals();
  const toast = useToaster();
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      name: data?.name || '',
      url: data?.url || '',
      integrations: data?.integrations?.map((p: any) => p.integration) || [],
    },
  });
  const integrations = form.watch('integrations');
  const changeIntegration = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const findValue = options.find(
        (option) => option.value === e.target.value
      )!;
      setAllIntegrations(findValue);
      if (findValue.value === 'all') {
        form.setValue('integrations', []);
      }
    },
    []
  );
  // Shared hook — a bespoke useSWR('integrations') here cached the RAW
  // {integrations} response under a key other components read as an array,
  // corrupting each other's data across SPA navigations.
  const { data: integrationList, isLoading } = useIntegrationList();
  const saving = useRef(false);
  const callBack = useCallback(
    async (values: any) => {
      // One save at a time: a double click created two webhooks (E2E-08-37).
      if (saving.current) return;
      saving.current = true;
      try {
        const res = await fetch('/webhooks', {
          method: data?.id ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(data?.id
              ? {
                  id: data.id,
                }
              : {}),
            ...values,
          }),
        });
        if (!res.ok) {
          toast.show(
            await refusalMessage(
              res,
              t('webhook_not_saved', 'The webhook was not saved.')
            ),
            'warning'
          );
          return;
        }
        toast.show(
          data?.id
            ? t('webhook_updated_successfully', 'Webhook updated successfully')
            : t('webhook_added_successfully', 'Webhook added successfully'),
          'success'
        );
        modal.closeAll();
        reload();
      } finally {
        saving.current = false;
      }
    },
    [data, integrations]
  );
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    toast.show(t('webhook_sent', 'Webhook send'), 'success');
    try {
      // A saved webhook's test is signed like its deliveries.
      await fetch(
        `/webhooks/send?url=${encodeURIComponent(url)}${
          data?.id ? `&id=${encodeURIComponent(data.id)}` : ''
        }`,
        {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: 'This is the first post to instagram',
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release/release',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test',
              providerIdentifier: 'instagram',
              picture: 'https://postra.pl/logo.png',
              type: 'social',
            },
          },
          {
            id: 'cm6tcts4f0005qcwit25cis26',
            content: 'This is the second post to facebook',
            publishDate: '2025-02-06T13:09:00.000Z',
            releaseURL: 'https://facebook.com/release2/release2',
            state: 'PUBLISHED',
            integration: {
              id: 'cm6s4uyou0001i2r47pxix6z1',
              name: 'test2',
              providerIdentifier: 'facebook',
              picture: 'https://postra.pl/logo.png',
              type: 'social',
            },
          },
        ]),
      });
    } catch (e: any) {
      /** empty **/
    }
  }, [data]);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[12px] pt-0">
          <div>
            <Input
              label="Name"
              translationKey="label_name"
              {...form.register('name')}
            />
            <Input
              label="URL"
              translationKey="label_url"
              {...form.register('url')}
            />
            <Select
              value={allIntegrations.value}
              name="integrations"
              label="Integrations"
              translationKey="label_integrations"
              disableForm={true}
              onChange={changeIntegration}
            >
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            {allIntegrations.value === 'specific' && !isLoading && (
              <PickPlatforms
                integrations={integrationList}
                selectedIntegrations={integrations as any[]}
                onChange={(e) => form.setValue('integrations', e)}
                singleSelect={false}
                toolTip={true}
                isMain={true}
              />
            )}
            {data?.id && <WebhookSecret id={data.id} />}
            <div className="flex gap-[10px]">
              <Button
                type="submit"
                className="mt-[24px]"
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('save', 'Save')}
              </Button>
              <Button
                type="button"
                secondary={true}
                className="mt-[24px]"
                onClick={sendTest}
                disabled={
                  !form.formState.isValid ||
                  (allIntegrations.value === 'specific' &&
                    !integrations?.length)
                }
              >
                {t('send_test', 'Send Test')}
              </Button>
            </div>
          </div>
        </div>
      </form>
    </FormProvider>
  );
};
