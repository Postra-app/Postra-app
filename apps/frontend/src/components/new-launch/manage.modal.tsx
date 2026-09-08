'use client';

import React, {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AddEditModalProps } from '@gitroom/frontend/components/new-launch/add.edit.modal';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { PicksSocialsComponent } from '@gitroom/frontend/components/new-launch/picks.socials.component';
import { EditorWrapper } from '@gitroom/frontend/components/new-launch/editor';
import { SelectCurrent } from '@gitroom/frontend/components/new-launch/select.current';
import { ShowAllProviders } from '@gitroom/frontend/components/new-launch/providers/show.all.providers';
import { useExistingData } from '@gitroom/frontend/components/launches/helpers/use.existing.data';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { DatePicker } from '@gitroom/frontend/components/launches/helpers/date.picker';
import { useShallow } from 'zustand/react/shallow';
import { RepeatComponent } from '@gitroom/frontend/components/launches/repeat.component';
import { TagsComponent } from '@gitroom/frontend/components/launches/tags.component';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { readResponseError } from '@gitroom/helpers/utils/response.error';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { capitalize } from 'lodash';
import { SelectCustomer } from '@gitroom/frontend/components/launches/select.customer';
import { DummyCodeComponent } from '@gitroom/frontend/components/new-launch/dummy.code.component';
import { CreationMethodBadge } from '@gitroom/frontend/components/launches/creation.method.badge';
import {
  SettingsIcon,
  ChevronDownIcon,
  CloseIcon,
  TrashIcon,
  DropdownArrowSmallIcon,
} from '@gitroom/frontend/components/ui/icons';
import { useHasScroll } from '@gitroom/frontend/components/ui/is.scroll.hook';
import { useShortlinkPreference } from '@gitroom/frontend/components/settings/shortlink-preference.component';
import dayjs from 'dayjs';
import { Button } from '@gitroom/frontend/components/ui/button';

export const ManageModal: FC<AddEditModalProps> = (props) => {
  const t = useT();
  const fetch = useFetch();
  const ref = useRef(null);
  const existingData = useExistingData();
  const [loading, setLoading] = useState(false);
  const toaster = useToaster();
  const modal = useModals();
  const [showSettings, setShowSettings] = useState(false);
  const [settingsPulse, setSettingsPulse] = useState(false);
  const { data: shortlinkPreferenceData } = useShortlinkPreference();

  const { addEditSets, mutate, customClose, dummy } = props;

  const {
    selectedIntegrations,
    hide,
    date,
    setDate,
    repeater,
    setRepeater,
    tags,
    setTags,
    integrations,
    setSelectedIntegrations,
    locked,
    current,
    activateExitButton,
    setHide,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      current: state.current,
      repeater: state.repeater,
      setRepeater: state.setRepeater,
      tags: state.tags,
      setTags: state.setTags,
      selectedIntegrations: state.selectedIntegrations,
      integrations: state.integrations,
      setSelectedIntegrations: state.setSelectedIntegrations,
      locked: state.locked,
      activateExitButton: state.activateExitButton,
    }))
  );

  const prevIntegrationCount = useRef(selectedIntegrations.length);

  useEffect(() => {
    if (hide) {
      setHide(false);
    }
  }, [hide]);

  useEffect(() => {
    if (selectedIntegrations.length > prevIntegrationCount.current) {
      setSettingsPulse(true);
      const timer = setTimeout(() => setSettingsPulse(false), 1500);
      prevIntegrationCount.current = selectedIntegrations.length;
      return () => clearTimeout(timer);
    }
    prevIntegrationCount.current = selectedIntegrations.length;
  }, [selectedIntegrations.length]);

  const currentIntegrationText = useMemo(() => {
    if (current === 'global') {
      return (
        <div className="flex items-center gap-[10px]">
          <div className="relative">
            <SettingsIcon size={15} className="text-white" />
          </div>
          <div>Settings</div>
        </div>
      );
    }

    const currentIntegration = integrations.find((p) => p.id === current)!;

    return (
      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <img
            src={`/icons/platforms/${currentIntegration.identifier}.png`}
            className="w-[20px] h-[20px] rounded-[4px]"
            alt={currentIntegration.identifier}
          />
          <SettingsIcon
            size={15}
            className="text-white absolute -end-[5px] -bottom-[5px]"
          />
        </div>
        <div>
          {currentIntegration.name} {t('channel_settings', 'Settings')}
        </div>
      </div>
    );
  }, [current]);

  const changeCustomer = useCallback(
    (customer: string) => {
      const neededIntegrations = integrations.filter(
        (p) => p?.customer?.id === customer
      );
      setSelectedIntegrations(
        neededIntegrations.map((p) => ({
          settings: {},
          selectedIntegrations: p,
        }))
      );
    },
    [integrations]
  );

  const askClose = useCallback(async () => {
    if (!activateExitButton || dummy) {
      return;
    }

    if (
      await deleteDialog(
        t(
          'are_you_sure_you_want_to_close_this_modal_all_data_will_be_lost',
          'Are you sure you want to close this modal? (all data will be lost)'
        ),
        t('yes_close_it', 'Yes, close it!')
      )
    ) {
      if (customClose) {
        customClose();
        return;
      }
      modal.closeAll();
    }
  }, [activateExitButton, dummy]);

  const deletePost = useCallback(async () => {
    setLoading(true);
    try {
      if (
        !(await deleteDialog(
          t(
            'are_you_sure_you_want_to_delete_post',
            'Are you sure you want to delete this post?'
          ),
          t('yes_delete_it', 'Yes, delete it!')
        ))
      ) {
        return;
      }
      const response = await fetch(`/posts/${existingData.group}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        toaster.show(
          `${t(
            'post_delete_failed',
            'Could not delete the post'
          )}: ${await readResponseError(response)}`,
          'warning'
        );
        return;
      }
      mutate();
      modal.closeAll();
    } catch (e) {
      console.error('[Postra:posts] delete failed', e);
      toaster.show(
        t('post_delete_failed', 'Could not delete the post'),
        'warning'
      );
    } finally {
      setLoading(false);
    }
  }, [existingData, mutate, modal]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      if (
        (type === 'now' || type === 'schedule') &&
        (existingData?.posts?.[0]?.state === 'PUBLISHED' ||
          (existingData?.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(date.utc())))
      ) {
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            title: 'What do you want to do?',
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  This post was already published, what do you want to do?
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('update')}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => resolve('republish')}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (whatToDo === 'update') {
          type = 'update';
        }
      }

      setLoading(true);

      try {
        // Pull the local values to build the payload, but rely on the server
        // (`/posts/valid`) for the actual validation — checkValidity now lives
        // server-side so it can't be bypassed.
        const allValues = await ref.current.getAllValues();

        const integrationById = (id: string) =>
          selectedIntegrations.find((p) => p.integration.id === id);

        const group = existingData.group || makeId(10);

        const posts = allValues.map((post: any) => ({
          integration: {
            id: post.id,
          },
          group,
          settings: { ...(post.settings || {}) },
          value: post.values.map((value: any) => ({
            ...(value.id ? { id: value.id } : {}),
            content: value.content,
            delay: value.delay || 0,
            image:
              (value?.media || []).map(
                ({ id, path, alt, thumbnail, thumbnailTimestamp }: any) => ({
                  id,
                  path,
                  alt,
                  thumbnail,
                  thumbnailTimestamp,
                })
              ) || [],
          })),
        }));

        if (!dummy) {
          const validResponse = await fetch('/posts/valid', {
            method: 'POST',
            body: JSON.stringify({ type, posts }),
          });
          if (!validResponse.ok) {
            console.error(
              '[Postra:posts] /posts/valid failed',
              validResponse.status
            );
            toaster.show(
              `${t(
                'post_validation_failed',
                'Could not validate the post'
              )}: ${await readResponseError(validResponse)}`,
              'warning'
            );
            return;
          }
          const checkAllValid = await validResponse.json();

          const focus = (id: string, where: 'fix' | 'preview') => {
            integrationById(id)?.ref?.current?.[where]?.();
          };

          const notEnoughChars = checkAllValid.filter(
            (p: any) => p.emptyContent
          );

          for (const item of notEnoughChars) {
            toaster.show(
              `${capitalize(item.identifier.split('-')[0])} (${item.name}):` +
                ' ' +
                t(
                  'post_needs_content_or_image',
                  'Your post should have at least one character or one image.'
                ),
              'warning'
            );
            setLoading(false);
            focus(item.id, 'preview');
            return;
          }

          if (type !== 'draft') {
            for (const item of checkAllValid) {
              if (item.valid === false) {
                toaster.show(
                  `${capitalize(item.identifier.split('-')[0])} (${
                    item.name
                  }): ${
                    item.settingsError ||
                    t('please_fix_your_settings', 'Please fix your settings')
                  }`,
                  'warning'
                );
                focus(item.id, 'fix');
                setLoading(false);
                setShowSettings(true);
                return;
              }

              if (item.errors !== true) {
                toaster.show(
                  `${capitalize(item.identifier.split('-')[0])} (${
                    item.name
                  }): ${item.errors}`,
                  'warning'
                );
                focus(item.id, 'preview');
                setLoading(false);
                setShowSettings(false);
                return;
              }

              if (item.tooLong) {
                toaster.show(
                  `${item.name} (${item.identifier}) ${t(
                    'post_is_too_long',
                    'post is too long, please fix it'
                  )}`,
                  'warning'
                );
                focus(item.id, 'preview');
                setLoading(false);
                return;
              }
            }
          }
        }

        const shortlinkPreference = shortlinkPreferenceData?.shortlink || 'ASK';

        let shortLink = false;

        if (!dummy && shortlinkPreference !== 'NO') {
          const shortlinkResponse = await fetch('/posts/should-shortlink', {
            method: 'POST',
            body: JSON.stringify({
              messages: allValues
                // platforms that remove links won't keep shortlinks either
                .filter(
                  (p: any) => !integrationById(p.id)?.integration?.stripLinks
                )
                .flatMap((p: any) => p.values.flatMap((a: any) => a.content)),
            }),
          });
          if (!shortlinkResponse.ok) {
            // shortlinking is optional — a failure here must not block publishing
            console.error(
              '[Postra:posts] /posts/should-shortlink failed',
              shortlinkResponse.status
            );
          }
          const shortLinkUrl = shortlinkResponse.ok
            ? await shortlinkResponse.json()
            : { ask: false };

          if (shortLinkUrl.ask) {
            if (shortlinkPreference === 'YES') {
              // Automatically shortlink without asking
              shortLink = true;
            } else {
              // ASK: Show the dialog
              shortLink = await deleteDialog(
                t(
                  'shortlink_urls_question',
                  'Do you want to shortlink the URLs? it will let you get statistics over clicks'
                ),
                t('yes_shortlink_it', 'Yes, shortlink it!')
              );
            }
          }
        }

        const data = {
          type,
          ...(repeater ? { inter: repeater } : {}),
          tags,
          shortLink,
          date: date.utc().format('YYYY-MM-DDTHH:mm:ss'),
          posts,
        };

        if (dummy) {
          modal.openModal({
            title: '',
            children: <DummyCodeComponent code={data} />,
            classNames: {
              modal: 'w-[100%] bg-transparent text-textColor',
            },
            size: '100%',
            withCloseButton: false,
            closeOnEscape: true,
            closeOnClickOutside: true,
          });

          setLoading(false);
        }

        if (!dummy) {
          if (addEditSets) {
            addEditSets(data);
          } else {
            const saveResponse = await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify(data),
            });
            if (!saveResponse.ok) {
              console.error('[Postra:posts] save failed', saveResponse.status);
              toaster.show(
                `${t(
                  'post_save_failed',
                  'Could not save the post'
                )}: ${await readResponseError(saveResponse)}`,
                'warning'
              );
              return;
            }
            mutate();
            toaster.show(
              !existingData.integration
                ? t('added_successfully', 'Added successfully')
                : t('updated_successfully', 'Updated successfully')
            );
          }
          if (customClose) {
            setTimeout(() => {
              customClose();
            }, 2000);
          }

          if (!addEditSets) {
            modal.closeAll();
          }
        }
      } catch (e) {
        console.error('[Postra:posts] schedule failed', e);
        toaster.show(
          t(
            'post_save_unexpected_error',
            'Something went wrong while saving. Your content is still here — please try again.'
          ),
          'warning'
        );
      } finally {
        setLoading(false);
      }
    },
    [ref, repeater, tags, date, addEditSets, dummy, shortlinkPreferenceData]
  );

  return (
    <div className="w-full h-full flex-1 p-[40px] phone:p-0 flex relative">
      <div className="flex flex-1 bg-white/[0.03] rounded-[20px] flex-col">
        <div className="flex-1 flex">
          <div className="flex flex-col flex-1 border-e border-newBorder phone:border-e-0">
            <div className="bg-newBgColor h-[65px] rounded-s-[20px] !rounded-b-[0] flex items-center phone:justify-center gap-[12px] px-[20px] text-[20px] font-[600] relative">
              {t('create_post_title', 'Create Post')}
              <CreationMethodBadge
                creationMethod={existingData?.posts?.[0]?.creationMethod}
                size="sm"
              />
              <div
                onClick={askClose}
                className="hidden phone:flex absolute end-[16px] top-1/2 -translate-y-1/2 cursor-pointer text-[#A3A3A3] hover:text-white"
              >
                <CloseIcon />
              </div>
            </div>
            <div className="flex-1 flex flex-col gap-[16px]">
              <div
                className={clsx('flex-1 relative', showSettings && 'hidden')}
              >
                <div
                  id="social-content"
                  className="gap-[32px] flex flex-col pe-[8px] pt-[20px] ps-[20px] absolute top-0 left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
                >
                  <div className="flex w-full">
                    <div className="flex flex-1">
                      <PicksSocialsComponent toolTip={true} />
                    </div>
                    <div>
                      {!dummy && (
                        <SelectCustomer
                          onChange={changeCustomer}
                          integrations={integrations}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 gap-[6px] flex-col">
                    <div>{!existingData.integration && <SelectCurrent />}</div>
                    <div className="flex-1 flex">
                      {!hide && <EditorWrapper totalPosts={1} value="" />}
                    </div>
                    <div
                      id="social-empty"
                      className={clsx(
                        'pb-[16px]'
                        // current !== 'global' && 'hidden'
                      )}
                    />
                  </div>
                </div>
              </div>
              <div
                id="wrapper-settings"
                className={clsx(
                  'pb-[20px] px-[20px] select-none',
                  showSettings && 'flex-1 flex pt-[20px]',
                  current === 'global' && 'hidden'
                )}
              >
                <div className="flex-1 flex flex-col rounded-[12px] gap-[12px] overflow-hidden bg-newSettings">
                  <div
                    onClick={() => setShowSettings(!showSettings)}
                    className={clsx(
                      'bg-[#38bdf8] rounded-[12px] flex items-center gap-[8px] cursor-pointer p-[12px] transition-shadow',
                      showSettings ? '!rounded-b-none' : '',
                      settingsPulse && 'animate-settings-pulse'
                    )}
                    onAnimationEnd={() => setSettingsPulse(false)}
                  >
                    <div className="flex-1 text-[14px] font-[600] text-white">
                      {currentIntegrationText}
                    </div>
                    <div>
                      <ChevronDownIcon
                        rotated={showSettings}
                        className="text-white"
                      />
                    </div>
                  </div>
                  <div
                    className={clsx(
                      !showSettings ? 'hidden' : 'flex-1',
                      'text-[14px] text-textColor font-[500] relative'
                    )}
                  >
                    <div className="absolute left-0 top-0 w-full h-full flex flex-col overflow-x-hidden overflow-y-auto scrollbar scrollbar-thumb-newBgColorInner scrollbar-track-newColColor">
                      <div
                        id="social-settings"
                        className="flex flex-col gap-[20px] bg-newBgColor"
                      />
                    </div>
                  </div>
                  <style>
                    {`#social-settings [data-id="${current}"] {display: block !important;}
@keyframes settings-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
  25% { box-shadow: 0 0 16px 4px rgba(56, 189, 248, 0.7); }
  50% { box-shadow: 0 0 0 0 rgba(56, 189, 248, 0); }
  75% { box-shadow: 0 0 16px 4px rgba(56, 189, 248, 0.7); }
}
.animate-settings-pulse { animation: settings-pulse 1.5s ease-in-out; }`}
                  </style>
                </div>
              </div>
            </div>
          </div>
          <div className="w-[580px] phone:hidden flex flex-col">
            <div className="bg-newBgColor h-[65px] rounded-e-[20px] !rounded-b-[0] flex items-center px-[20px] text-[20px] font-[600]">
              <div className="flex-1">{t('post_preview', 'Post Preview')}</div>
              <div className="cursor-pointer">
                <CloseIcon onClick={askClose} className="text-[#A3A3A3]" />
              </div>
            </div>
            <div className="flex-1 relative">
              <Scrollable
                scrollClasses="!pe-[20px]"
                className="absolute top-0 p-[20px] pe-[8px] left-0 w-full h-full overflow-x-hidden overflow-y-scroll scrollbar scrollbar-thumb-newColColor scrollbar-track-newBgColorInner"
              >
                <ShowAllProviders ref={ref} />
              </Scrollable>
            </div>
          </div>
        </div>
        <div className="select-none h-[84px] phone:h-auto phone:flex-col phone:items-stretch phone:gap-[12px] phone:py-[12px] py-[20px] border-t border-newBorder flex items-center">
          <div className="flex-1 flex phone:flex-wrap phone:justify-center ps-[20px] phone:ps-0 gap-[8px]">
            {!dummy && (
              <TagsComponent
                name="tags"
                label={t('tags', 'Tags')}
                initial={tags}
                onChange={(e) => {
                  setTags(e.target.value);
                }}
              />
            )}

            {!dummy && (
              <RepeatComponent repeat={repeater} onChange={setRepeater} />
            )}
          </div>
          <div className="pe-[20px] phone:pe-0 flex items-center justify-end phone:justify-center phone:flex-wrap gap-[8px]">
            {existingData?.integration && (
              <button
                onClick={deletePost}
                className="cursor-pointer flex text-[#FF3F3F] gap-[8px] items-center text-[15px] font-[600]"
              >
                <div>
                  <TrashIcon />
                </div>
                <div>{t('delete_post', 'Delete Post')}</div>
              </button>
            )}
            <DatePicker onChange={setDate} date={date} />
            {!addEditSets && (
              <button
                disabled={
                  selectedIntegrations.length === 0 || loading || locked
                }
                onClick={schedule('draft')}
                className="relative cursor-pointer disabled:cursor-not-allowed px-[20px] h-[44px] bg-btnSimple justify-center items-center flex rounded-[8px] text-[15px] font-[600]"
              >
                {loading && (
                  <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                    <div className="animate-spin h-[20px] w-[20px] border-4 border-textColor border-t-transparent rounded-full" />
                  </div>
                )}
                <div className={clsx(loading && 'invisible')}>
                  {t('save_as_draft', 'Save as Draft')}
                </div>
              </button>
            )}
            {addEditSets && (
              <button
                className="text-white text-[15px] font-[600] min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-[8px] bg-[#38bdf8] ps-[20px] pe-[16px]"
                disabled={
                  selectedIntegrations.length === 0 || loading || locked
                }
                onClick={schedule('draft')}
              >
                Save Set
              </button>
            )}
            {!addEditSets && (
              <div className="group cursor-pointer relative">
                <button
                  disabled={
                    selectedIntegrations.length === 0 || loading || locked
                  }
                  onClick={schedule('schedule')}
                  className="text-white relative min-w-[180px] btnSub disabled:cursor-not-allowed disabled:opacity-80 outline-none gap-[8px] flex justify-center items-center h-[44px] rounded-[8px] bg-[#38bdf8] ps-[20px] pe-[16px]"
                >
                  {loading && (
                    <div className="absolute left-[50%] top-[50%] -translate-y-[50%] -translate-x-[50%]">
                      <div className="animate-spin h-[20px] w-[20px] border-4 border-white border-t-transparent rounded-full" />
                    </div>
                  )}
                  <div
                    className={clsx(
                      'text-[15px] font-[600]',
                      loading && 'invisible'
                    )}
                  >
                    {selectedIntegrations.length === 0
                      ? t('check_circles_above', 'Check the circles above')
                      : dummy
                      ? t('create_output', 'Create output')
                      : !existingData?.integration
                      ? t('add_to_calendar', 'Add to calendar')
                      : existingData?.posts?.[0]?.state === 'DRAFT'
                      ? t('schedule', 'Schedule')
                      : t('update', 'Update')}
                  </div>
                  {!dummy && (
                    <div className="flex justify-center items-center h-[20px] w-[20px] pt-[4px] arrow-change">
                      <DropdownArrowSmallIcon className="group-hover:rotate-180 text-white" />
                    </div>
                  )}
                </button>

                {!dummy && (
                  <button
                    onClick={schedule('now')}
                    disabled={
                      selectedIntegrations.length === 0 || loading || locked
                    }
                    className="rounded-[8px] z-[300] disabled:cursor-not-allowed disabled:opacity-80 hidden group-hover:flex absolute bottom-[100%] -left-[12px] p-[12px] w-[206px] bg-white/[0.03]"
                  >
                    <div className="text-white rounded-[8px] bg-[#D82D7E] h-[44px] w-full flex justify-center items-center post-now">
                      {t('post_now', 'Post Now')}
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Scrollable: FC<{
  className: string;
  scrollClasses: string;
  children: ReactNode;
}> = ({ className, scrollClasses, children }) => {
  const ref = useRef(undefined);
  const hasScroll = useHasScroll(ref);
  return (
    <div className={clsx(className, hasScroll && scrollClasses)} ref={ref}>
      {children}
    </div>
  );
};
