'use client';
import 'reflect-metadata';

import React, { FC, Fragment, useCallback, useMemo, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { safeJsonParse } from '@gitroom/helpers/utils/safe.json.parse';
import useSWR from 'swr';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import { Card } from '@gitroom/frontend/components/ui/card';
import { Input } from '@gitroom/react/form/input';
import { useToaster } from '@gitroom/react/toaster/toaster';
import clsx from 'clsx';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import dynamic from 'next/dynamic';
// The composer pulls ~13 @tiptap packages: load it when the modal opens. A
// static import here put it into this route's bundle, and the menu prefetches
// every route, so each page downloaded the editor (387 KB) up front.
const AddEditModal = dynamic(
  () =>
    import('@gitroom/frontend/components/new-launch/add.edit.modal').then(
      (mod) => mod.AddEditModal
    ),
  { ssr: false }
);
import { newDayjs } from '@gitroom/frontend/components/layout/set.timezone';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';

const SaveSetModal: FC<{
  postData: any;
  initialValue?: string;
  onSave: (name: string) => void;
  onCancel: () => void;
}> = ({ postData, onSave, onCancel, initialValue }) => {
  const [name, setName] = useState(initialValue);
  const t = useT();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSave(name.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <Input
          label={t('set_name', 'Set name')}
          name="setName"
          value={name}
          disableForm={true}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('enter_set_name', 'Enter a name for this set')}
          autoFocus
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button type="button" secondary onClick={onCancel}>
          {t('cancel', 'Cancel')}
        </Button>
        <Button type="submit" disabled={!name.trim()}>
          {t('save', 'Save')}
        </Button>
      </div>
    </form>
  );
};

export const Sets: FC = () => {
  const fetch = useFetch();
  const user = useUser();
  const modal = useModals();
  const toaster = useToaster();
  const t = useT();

  const load = useCallback(async (path: string) => {
    return (await (await fetch(path)).json()).integrations;
  }, []);

  const { isLoading, data: integrations } = useSWR('/integrations/list', load, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    fallbackData: [],
  });

  const list = useCallback(async () => {
    return (await fetch('/sets')).json();
  }, []);

  const { data, mutate } = useSWR('sets', list, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    revalidateOnMount: true,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
  });

  const addSet = useCallback(
    (params?: { id?: string; name?: string; content?: string }) => () => {
      modal.openModal({
        id: 'add-edit-modal',
        ariaLabel: 'Post editor',
        closeOnClickOutside: false,
        removeLayout: true,
        closeOnEscape: false,
        withCloseButton: false,
        askClose: true,
        fullScreen: true,
        classNames: {
          modal: 'w-[100%] max-w-[1400px] text-textColor',
        },
        children: (
          <AddEditModal
            allIntegrations={integrations.map((p: any) => ({
              ...p,
            }))}
            {...(params?.id ? { set: safeJsonParse<any>(params.content, undefined) } : {})}
            addEditSets={(data) => {
              modal.openModal({
                title: t('save_as_set', 'Save as set'),
                children: (
                  <SaveSetModal
                    initialValue={params?.name || ''}
                    postData={data}
                    onSave={async (name: string) => {
                      try {
                        await fetch('/sets', {
                          method: 'POST',
                          body: JSON.stringify({
                            ...(params?.id ? { id: params.id } : {}),
                            name,
                            content: JSON.stringify(data),
                          }),
                        });
                        modal.closeAll();
                        mutate();
                        toaster.show(t('set_saved', 'Set saved'), 'success');
                      } catch (error) {
                        toaster.show(
                          t('set_save_failed', 'Could not save the set'),
                          'warning'
                        );
                      }
                    }}
                    onCancel={() => modal.closeAll()}
                  />
                ),
              });
            }}
            reopenModal={() => {}}
            mutate={() => {}}
            integrations={integrations}
            date={newDayjs()}
          />
        ),
        title: ``,
      });
    },
    [integrations]
  );

  const deleteSet = useCallback(
    (data: any) => async () => {
      if (
        await deleteDialog(
          t('are_you_sure_you_want_to_delete', 'Are you sure you want to delete?', {
            name: data.name,
          })
        )
      ) {
        await fetch(`/sets/${data.id}`, {
          method: 'DELETE',
        });
        mutate();
        toaster.show(t('set_deleted', 'Set deleted'), 'success');
      }
    },
    []
  );

  return (
    <div className="flex flex-col">
      <h3 className="text-[22px] font-[650] tracking-[-0.2px] text-newTextColor">
        {t('sets', 'Sets')} ({data?.length || 0})
      </h3>
      <div className="text-[12.5px] text-newTextColor/55 mt-[3px]">
        {t(
          'sets_description',
          'Manage content sets for easy reuse across your posts.'
        )}
      </div>
      <Card className="my-[16px] items-center p-[24px] flex gap-[24px]">
        <div className="flex flex-col w-full">
          {!!data?.length && (
            <div className="grid grid-cols-[2fr,1fr,1fr] w-full gap-y-[10px]">
              <div>{t('name', 'Name')}</div>
              <div>{t('edit', 'Edit')}</div>
              <div>{t('delete', 'Delete')}</div>
              {data?.map((p: any) => (
                <Fragment key={p.id}>
                  <div className="flex flex-col justify-center">{p.name}</div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button variant="secondary" onClick={addSet(p)}>
                        {t('edit', 'Edit')}
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-col justify-center">
                    <div>
                      <Button variant="danger" onClick={deleteSet(p)}>
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
              onClick={addSet()}
              className={clsx((data?.length || 0) > 0 && 'my-[16px]')}
            >
              {t('add_a_set', 'Add a set')}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};
