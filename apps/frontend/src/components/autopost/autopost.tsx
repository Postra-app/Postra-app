'use client';

import React, {
  FC,
  Fragment,
  useCallback,
  useMemo,
  useState,
  useRef,
} from 'react';
import { refusalMessage } from '@gitroom/frontend/components/layout/response.error';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { Input } from '@gitroom/react/form/input';
import { FormProvider, useForm } from 'react-hook-form';
import { array, boolean, object, string } from 'yup';
import { yupResolver } from '@hookform/resolvers/yup';
import { Select } from '@gitroom/react/form/select';
import { PickPlatforms } from '@gitroom/frontend/components/launches/helpers/pick.platform.component';
import { useIntegrationList } from '@gitroom/frontend/components/launches/helpers/use.integration.list';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import dynamic from 'next/dynamic';
const CopilotTextarea = dynamic(
  () => import('@copilotkit/react-textarea').then((mod) => mod.CopilotTextarea),
  { ssr: false }
);
import { Slider } from '@gitroom/react/form/slider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import Spinner from '@gitroom/frontend/components/layout/loading';
import { EmptyState } from '@gitroom/frontend/components/ui/empty-state';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { autopostAccess } from '@gitroom/frontend/components/autopost/autopost.access';
export const Autopost: FC = () => {
  const fetch = useFetch();
  const t = useT();
  const modal = useModals();
  const toaster = useToaster();
  const list = useCallback(async () => {
    return (await fetch('/autopost')).json();
  }, []);
  const { data, isLoading, mutate } = useSWR('autopost', list);
  const user = useUser();
  const access = autopostAccess(user?.tier as any, data?.length || 0);
  const addWebhook = useCallback(
    (data?: any) => () => {
      modal.openModal({
        title: data
          ? t('edit_autopost', 'Edit Autopost')
          : t('add_autopost_title', 'Add Autopost'),
        withCloseButton: true,
        children: <AddOrEditWebhook data={data} reload={mutate} />,
      });
    },
    []
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
        await fetch(`/autopost/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(
          t('autopost_deleted', 'Auto Post feed deleted'),
          'success'
        );
      }
    },
    []
  );
  const changeActive = useCallback(
    (data: any) => async (ac: 'on' | 'off') => {
      await fetch(`/autopost/${data.id}/active`, {
        body: JSON.stringify({
          active: ac === 'on',
        }),
        method: 'POST',
      });
      mutate();
    },
    [mutate]
  );
  return (
    <div className="flex flex-col">
      <h3 className="text-[20px]">{t('autopost', 'Autopost')}</h3>
      <div className="text-newTextColor/55 mt-[4px]">
        {t(
          'autopost_can_automatically_posts_your_rss_new_items_to_social_media',
          'Autopost automatically publishes new RSS items to your social media'
        )}
      </div>
      <div className="my-[16px] mt-[16px] bg-white/[0.03] border-white/10 items-center border rounded-[16px] p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {isLoading ? (
            <div className="flex justify-center py-[16px]">
              <Spinner width={40} height={40} />
            </div>
          ) : !access.included && !data?.length ? (
            <div className="flex flex-col gap-[12px] py-[8px]">
              <div className="text-[18px] font-[600]">
                {t('autopost_upsell_title', 'Turn your blog into social posts')}
              </div>
              <div className="text-newTextColor/70 max-w-[640px]">
                {t(
                  'autopost_upsell_body',
                  "Auto Post watches your blog's RSS feed. When you publish a new article, AI writes a post about it for your channels and schedules it. Included in Pro ({{pro}} RSS feeds) and Business ({{business}}).",
                  {
                    pro: pricing.PRO.autoPostLimit,
                    business: pricing.ULTIMATE.autoPostLimit,
                  }
                )}
              </div>
              <div>
                <Button onClick={() => window.open('/billing', '_self')}>
                  {t('autopost_upsell_cta', 'See plans')}
                </Button>
              </div>
            </div>
          ) : !data?.length ? (
            <EmptyState
              title={t('no_autoposts_yet', 'No autoposts yet')}
              description={t(
                'no_autoposts_description',
                'Add an RSS feed and Postra will automatically post new items to your channels.'
              )}
              className="py-[12px]"
            />
          ) : (
            <div className="grid grid-cols-[1fr,1fr,1fr,1fr,1fr] w-full gap-y-[10px]">
              <div>{t('title', 'Title')}</div>
              <div>{t('url', 'URL')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              <div>{t('active', 'Active')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.title}</div>
                  <div className="flex flex-col justify-center">{p.url}</div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={addWebhook(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button onClick={deleteHook(p)}>
                        {t('delete', 'Delete')}
                      </Button>
                    </div>
                  </div>
                  <div>
                    <Slider
                      value={p.active ? 'on' : 'off'}
                      onChange={changeActive(p)}
                      fill={true}
                    />
                  </div>
                </Fragment>
              ))}
            </div>
          )}
          {access.included && (
            <div className="flex flex-wrap items-center gap-[12px]">
              <Button
                onClick={addWebhook()}
                disabled={access.atLimit}
                className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
              >
                {t('add_an_autopost', 'Add an autopost')}
              </Button>
              <span className="text-newTextColor/55 text-[13px]">
                {t(
                  'autopost_feeds_used',
                  '{{used}} of {{limit}} RSS feeds used',
                  {
                    used: access.used,
                    limit: access.limit,
                  }
                )}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
const details = object().shape({
  title: string().required(),
  content: string(),
  tone: string(),
  customInstructions: string(),
  onSlot: boolean().required(),
  syncLast: boolean().required(),
  url: string().url().required(),
  active: boolean().required(),
  addPicture: boolean().required(),
  generateContent: boolean().required(),
  integrations: array().of(
    object().shape({
      id: string().required(),
    })
  ),
});
const getOptions = (t: (key: string, fallback: string) => string) => [
  {
    label: t('all_integrations', 'All integrations'),
    value: 'all',
  },
  {
    label: t('specific_integrations', 'Specific integrations'),
    value: 'specific',
  },
];
const getOptionsChoose = (t: (key: string, fallback: string) => string) => [
  {
    label: t('yes', 'Yes'),
    value: true,
  },
  {
    label: t('no', 'No'),
    value: false,
  },
];
const getPostImmediately = (t: (key: string, fallback: string) => string) => [
  {
    label: t('post_on_next_available_slot', 'Post on the next available slot'),
    value: true,
  },
  {
    label: t('post_immediately', 'Post Immediately'),
    value: false,
  },
];
export const AddOrEditWebhook: FC<{
  data?: any;
  reload: () => void;
}> = (props) => {
  const { data, reload } = props;
  const fetch = useFetch();
  const t = useT();
  const options = getOptions(t);
  const optionsChoose = getOptionsChoose(t);
  const postImmediately = getPostImmediately(t);
  const [allIntegrations, setAllIntegrations] = useState(
    (JSON.parse(data?.integrations || '[]')?.length || 0) > 0
      ? options[1]
      : options[0]
  );
  const modal = useModals();
  const toast = useToaster();
  const [valid, setValid] = useState(data?.url || '');
  const [lastUrl, setLastUrl] = useState(data?.lastUrl || '');
  const form = useForm({
    resolver: yupResolver(details),
    values: {
      title: data?.title || '',
      content: data?.content || '',
      tone: data?.tone || '',
      customInstructions: data?.customInstructions || '',
      onSlot: data?.onSlot || false,
      syncLast: data?.syncLast || false,
      url: data?.url || '',
      // eslint-disable-next-line no-prototype-builtins
      active: data?.hasOwnProperty?.('active') ? data?.active : true,
      addPicture: data?.addPicture || false,
      // eslint-disable-next-line no-prototype-builtins
      generateContent: data?.hasOwnProperty?.('generateContent')
        ? data?.generateContent
        : true,
      integrations: JSON.parse(data?.integrations || '[]') || [],
    },
  });
  const generateContent = form.watch('generateContent');
  const content = form.watch('content');
  const url = form.watch('url');
  const syncLast = form.watch('syncLast');
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
      // One save at a time: a double click created two feeds publishing the
      // same RSS (E2E-06-20); a refused save is not "added" (E2E-08-36).
      if (saving.current) return;
      saving.current = true;
      let res: Response;
      try {
        res = await fetch(data?.id ? `/autopost/${data?.id}` : '/autopost', {
          method: data?.id ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(data?.id
              ? {
                  id: data.id,
                }
              : {}),
            ...values,
            ...(!syncLast
              ? {
                  lastUrl,
                }
              : {
                  lastUrl: '',
                }),
          }),
        });
      } finally {
        saving.current = false;
      }
      if (!res.ok) {
        toast.show(
          await refusalMessage(
            res,
            t('autopost_not_saved', 'The feed was not saved.')
          ),
          'warning'
        );
        return;
      }
      toast.show(
        data?.id
          ? t('autopost_updated_successfully', 'Autopost updated successfully')
          : t('autopost_added_successfully', 'Autopost added successfully'),
        'success'
      );
      modal.closeAll();
      reload();
    },
    [data, integrations, lastUrl, syncLast]
  );
  const sendTest = useCallback(async () => {
    const url = form.getValues('url');
    try {
      const { success, url: newUrl } = await (
        await fetch(`/autopost/send?url=${encodeURIComponent(url)}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      ).json();
      if (!success) {
        setValid('');
        toast.show(
          t('could_not_use_rss_feed', 'Could not use this RSS feed'),
          'warning'
        );
        return;
      }
      toast.show(t('rss_valid', 'RSS valid!'), 'success');
      setValid(url);
      setLastUrl(newUrl);
    } catch (e: any) {
      /** empty **/
    }
  }, []);

  return (
    <FormProvider {...form}>
      <form onSubmit={form.handleSubmit(callBack)}>
        <div className="relative flex gap-[20px] flex-col flex-1 rounded-[16px] border border-white/10 pt-0">
          <div>
            <Input
              label="Title"
              translationKey="label_title"
              {...form.register('title')}
            />
            <Input
              label="URL"
              translationKey="label_url"
              {...form.register('url')}
            />
            <Select
              label="Should we sync the current last post?"
              translationKey="label_should_sync_last_post"
              {...form.register('syncLast', {
                setValueAs: (value) => {
                  return value === 'true' || value === true;
                },
              })}
            >
              {optionsChoose.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label="When should we post it?"
              translationKey="label_when_post"
              {...form.register('onSlot', {
                setValueAs: (value) => value === 'true' || value === true,
              })}
            >
              {postImmediately.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              label="Autogenerate content"
              translationKey="label_autogenerate_content"
              {...form.register('generateContent', {
                setValueAs: (value) => value === 'true' || value === true,
              })}
            >
              {optionsChoose.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
            {!generateContent && (
              <>
                <div className={`text-[14px] mb-[6px]`}>
                  {t('post_content', 'Post content')}
                </div>
                <CopilotTextarea
                  disableBranding={true}
                  className={clsx(
                    '!min-h-40 !max-h-80 p-2 overflow-x-hidden scrollbar scrollbar-thumb-[#38bdf8] bg-white/[0.03] outline-none mb-[16px] border-white/10 border rounded-[16px]'
                  )}
                  value={content}
                  onChange={(e) => {
                    form.setValue('content', e.target.value);
                  }}
                  placeholder={t(
                    'write_your_post_placeholder',
                    'Write your post...'
                  )}
                  autosuggestionsConfig={{
                    textareaPurpose: `Assist me in writing social media post`,
                    chatApiConfigs: {},
                  }}
                />
              </>
            )}
            {generateContent && (
              <>
                <Input
                  label="Tone / Style (optional)"
                  translationKey="label_tone"
                  placeholder="e.g. professional, casual, humorous, inspirational"
                  {...form.register('tone')}
                />
                <div className="text-[14px] mb-[6px]">
                  {t(
                    'autopost_extra_context',
                    'Extra context for AI (optional)'
                  )}
                </div>
                <textarea
                  className="w-full min-h-24 max-h-60 p-2 overflow-x-hidden scrollbar scrollbar-thumb-[#38bdf8] bg-white/[0.03] outline-none mb-[16px] border-white/10 border rounded-[16px] text-[14px]"
                  placeholder={t(
                    'autopost_extra_context_placeholder',
                    'e.g. fitness brand — add one actionable gym tip; end with a question'
                  )}
                  {...form.register('customInstructions')}
                />
              </>
            )}
            <Select
              label="Generate Picture?"
              translationKey="label_generate_picture"
              {...form.register('addPicture', {
                setValueAs: (value) => value === 'true' || value === true,
              })}
            >
              {optionsChoose.map((option) => (
                <option key={String(option.value)} value={String(option.value)}>
                  {option.label}
                </option>
              ))}
            </Select>
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
            <div className="flex gap-[10px]">
              {valid === url && (syncLast || !!lastUrl) && (
                <Button
                  type="submit"
                  className="mt-[24px]"
                  disabled={
                    valid !== url ||
                    !form.formState.isValid ||
                    (allIntegrations.value === 'specific' &&
                      !integrations?.length)
                  }
                >
                  {t('save', 'Save')}
                </Button>
              )}
              <Button
                type="button"
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
