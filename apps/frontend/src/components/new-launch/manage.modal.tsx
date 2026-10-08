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
  // Phones have no room for the preview column beside the editor; the
  // preview takes the editor's place instead (upstream 48aa7e2c).
  const [phoneTab, setPhoneTab] = useState<'edit' | 'preview'>('edit');
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
    channelDates,
    setChannelDate,
  } = useLaunchStore(
    useShallow((state) => ({
      hide: state.hide,
      setHide: state.setHide,
      date: state.date,
      setDate: state.setDate,
      channelDates: state.channelDates,
      setChannelDate: state.setChannelDate,
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

  // Group schedules: the channels the post was saved with, each its own post
  // with its own date. The channel in view, or the one that was opened.
  const existingPosts = useMemo(
    () => [existingData, ...(existingData.siblings || [])],
    [existingData]
  );
  const channel =
    existingPosts.find((p) => p.integration === current) || existingData;
  const channelDate = channelDates[current];
  const pickerDate = channelDate || date;
  const setPickerDate = useCallback(
    (newDate: dayjs.Dayjs) => {
      if (channelDate) {
        return setChannelDate(current, newDate);
      }
      setDate(newDate);
    },
    [channelDate, current]
  );
  const channelName = (id: string) =>
    integrations.find((i) => i.id === id)?.name || '';
  const dateOf = (id: string) => channelDates[id] || date;

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
      let groups: string[] = [existingData.group!];
      if (existingData.siblings?.length) {
        // Saved for several channels: all of them, or only the one in view.
        groups = await new Promise<string[]>((resolve) => {
          modal.openModal({
            id: 'delete-post-channels',
            title: t('delete_post', 'Delete Post'),
            onClose: () => resolve([]),
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  {t(
                    'delete_post_from_all_channels_question',
                    'This post was created for more than one channel. Do you want to delete it from all of them?'
                  )}
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => {
                        modal.closeById('delete-post-channels');
                        resolve(existingPosts.map((p) => p.group!));
                      }}
                    >
                      {t('delete_from_all_channels', 'Delete from all channels')}
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      secondary
                      className="flex-1"
                      onClick={() => {
                        modal.closeById('delete-post-channels');
                        resolve([channel.group!]);
                      }}
                    >
                      {t('delete_only_from', 'Only from')}{' '}
                      {channelName(channel.integration)}
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });
        if (!groups.length) {
          return;
        }
      } else if (
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
      for (const group of groups) {
        const response = await fetch(`/posts/${group}`, {
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
          // The channels deleted before the failure leave the calendar.
          mutate();
          return;
        }
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
  }, [existingData, existingPosts, channel, mutate, modal, integrations]);

  const schedule = useCallback(
    (type: 'draft' | 'now' | 'schedule' | 'update') => async () => {
      let republish = false;
      // Group schedules: the channels saved as another type than `type`.
      const saveAs: Record<string, 'draft' | 'schedule' | 'update'> = {};
      const saveTypeOf = (id: string) => saveAs[id] || type;
      const existing = existingPosts.filter((p) => p.integration);
      // The channels that already went out, or are going out right now.
      const published = existing.filter(
        (p) =>
          p.posts?.[0]?.state === 'PUBLISHED' ||
          (p.posts?.[0]?.state === 'QUEUE' &&
            dayjs().isAfter(dateOf(p.integration).utc()))
      );
      const others = existing.filter((p) => p !== channel);

      // Another channel whose date already passed would go out right away; it
      // only gets its details saved.
      if (type === 'schedule') {
        for (const p of others) {
          if (
            !published.includes(p) &&
            dayjs().isAfter(dateOf(p.integration).utc())
          ) {
            saveAs[p.integration] = 'update';
          }
        }
      }

      // A draft of a post with other channels leaves the published ones as
      // they are.
      if (type === 'draft' && existingData.siblings?.length) {
        for (const p of published) {
          if (p.posts[0].state === 'PUBLISHED') {
            saveAs[p.integration] = 'update';
          }
        }
      }

      // The save that leaves a channel in its state.
      const asItIs = (p: (typeof existing)[number]) =>
        p.posts?.[0]?.state === 'DRAFT'
          ? 'draft'
          : p.posts?.[0]?.state === 'QUEUE' && !published.includes(p)
          ? 'schedule'
          : 'update';

      // Like the delete: a save that would change the state of the other
      // channels (scheduling their drafts, moving them to drafts) asks
      // whether to do it for all of them or only the channel in view.
      if (
        type !== 'update' &&
        others.some(
          (p) =>
            !saveAs[p.integration] &&
            // the republish question covers the published ones
            (type === 'draft' || !published.includes(p)) &&
            asItIs(p) !== type
        )
      ) {
        const question =
          type === 'draft'
            ? t(
                'draft_post_in_all_channels_question',
                'This post was created for more than one channel. Do you want to move all of them to drafts?'
              )
            : type === 'now'
            ? t(
                'post_now_in_all_channels_question',
                'This post was created for more than one channel. Do you want to post all of them now?'
              )
            : t(
                'schedule_post_in_all_channels_question',
                'This post was created for more than one channel. Do you want to schedule all of them?'
              );
        const allChannels =
          type === 'draft'
            ? t('draft_all_channels', 'Move all channels to drafts')
            : type === 'now'
            ? t('post_now_all_channels', 'Post all channels now')
            : t('schedule_all_channels', 'Schedule all channels');

        const whichChannels = await new Promise((resolve) => {
          modal.openModal({
            id: 'change-post-channels',
            title: t('what_do_you_want_to_do', 'What do you want to do?'),
            onClose: () => resolve(undefined),
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">{question}</div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => {
                        modal.closeById('change-post-channels');
                        resolve('all');
                      }}
                    >
                      {allChannels}
                    </Button>
                  </div>
                  {/* a published channel in view stays published on a draft */}
                  {!saveAs[channel.integration] && (
                    <div className="flex-1 flex">
                      <Button
                        type="button"
                        secondary
                        className="flex-1"
                        onClick={() => {
                          modal.closeById('change-post-channels');
                          resolve('only');
                        }}
                      >
                        {t('only_channel', 'Only')}{' '}
                        {channelName(channel.integration)}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ),
          });
        });

        if (!whichChannels) {
          return;
        }

        if (whichChannels === 'only') {
          for (const p of others) {
            saveAs[p.integration] = asItIs(p);
          }
        }
      }

      // The published channels that would go out again.
      const republishing = published.filter((p) => !saveAs[p.integration]);

      if ((type === 'now' || type === 'schedule') && republishing.length) {
        const channels = republishing
          .map((p) =>
            type === 'now'
              ? channelName(p.integration)
              : `${channelName(p.integration)} at ${dateOf(p.integration)
                  .local()
                  .format('DD/MM/YYYY HH:mm')}`
          )
          .join(', ');
        const recurring =
          !!repeater || !!existingData?.posts?.[0]?.intervalInDays;
        // It closes on a choice, so a save that then fails its checks shows
        // the channel to fix (upstream 003a77eb).
        const whatToDo = await new Promise((resolve) => {
          modal.openModal({
            id: 'republish-post',
            title: 'What do you want to do?',
            onClose: () => resolve(undefined),
            children: (
              <div className="flex flex-col">
                <div className="text-[20px] mb-[20px]">
                  This post was already published. Publishing it again sends
                  it to {channels || 'its channel'}
                  {type === 'now' ? ' right now' : ''}.
                  {recurring && (
                    <div className="mt-[10px] text-[16px]">
                      It repeats: your changes apply to every repeat from now
                      on.
                    </div>
                  )}
                </div>
                <div className="flex w-full gap-[10px]">
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => {
                        modal.closeById('republish-post');
                        resolve('update');
                      }}
                    >
                      Just update the post details
                    </Button>
                  </div>
                  <div className="flex-1 flex">
                    <Button
                      type="button"
                      className="flex-1"
                      onClick={() => {
                        modal.closeById('republish-post');
                        resolve('republish');
                      }}
                    >
                      Republish the post
                    </Button>
                  </div>
                </div>
              </div>
            ),
          });
        });

        if (!whatToDo) {
          return;
        }
        if (whatToDo === 'update') {
          for (const p of republishing) {
            saveAs[p.integration] = 'update';
          }
          // A post saved on its own (no other channels) keeps its single
          // update request, as before.
          if (!existingData.siblings?.length) {
            type = 'update';
          }
        }
        // The server refuses to requeue a published post without it.
        if (whatToDo === 'republish') {
          republish = true;
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
          // every channel of an existing post updates its own post
          group:
            existingPosts.find((p) => p.integration === post.id)?.group ||
            group,
          ...(channelDates[post.id]
            ? {
                date: channelDates[post.id]
                  .utc()
                  .format('YYYY-MM-DDTHH:mm:ss'),
              }
            : {}),
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

          // A channel saved as a draft gets these checks once it's scheduled.
          for (const item of checkAllValid.filter(
            (p: any) => saveTypeOf(p.id) !== 'draft'
          )) {
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

        // When the version in this editor was last saved: the server refuses
        // a save over a newer one (409) instead of replacing a colleague's
        // work. Every channel of the post counts, siblings included.
        const loadedAt = existingPosts
          .flatMap((p) => p.posts || [])
          .map((p: any) => p?.updatedAt)
          .filter(Boolean)
          .sort()
          .pop();

        const data: Record<string, any> = {
          type,
          ...(loadedAt ? { expectedUpdatedAt: loadedAt } : {}),
          ...(republish ? { republish } : {}),
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
            // One request for every channel, each with the type it is saved
            // as, so a refusal on one channel leaves the others unsaved too.
            const request: Record<string, any> = {
              ...data,
              posts: posts.map((p: any) => ({
                ...p,
                type: saveTypeOf(p.integration.id),
              })),
            };
            let saveResponse = await fetch('/posts', {
              method: 'POST',
              body: JSON.stringify(request),
            });
            if (saveResponse.status === 409) {
              const overwrite = await deleteDialog(
                t(
                  'post_changed_meanwhile',
                  'Someone else saved changes to this post after you opened it. Replace their version with yours, or keep theirs and close the editor?'
                ),
                t('overwrite_with_mine', 'Replace with mine'),
                t('post_changed_title', 'This post was changed'),
                t('keep_their_version', 'Keep theirs')
              );
              if (!overwrite) {
                mutate();
                modal.closeAll();
                return;
              }
              delete request.expectedUpdatedAt;
              saveResponse = await fetch('/posts', {
                method: 'POST',
                body: JSON.stringify(request),
              });
            }
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
    [
      ref,
      repeater,
      tags,
      date,
      channelDates,
      current,
      channel,
      existingPosts,
      integrations,
      addEditSets,
      dummy,
      shortlinkPreferenceData,
      selectedIntegrations,
      existingData,
    ]
  );

  return (
    <div className="w-full h-full flex-1 p-[40px] phone:p-0 flex relative">
      <div className="flex flex-1 bg-white/[0.03] rounded-[20px] flex-col">
        <div
          className={clsx(
            'flex-1 flex',
            phoneTab === 'preview' && 'phone:flex-col'
          )}
        >
          <div
            className={clsx(
              'flex flex-col flex-1 border-e border-newBorder phone:border-e-0',
              phoneTab === 'preview' && 'phone:flex-none'
            )}
          >
            <div className="bg-newBgColor h-[65px] rounded-s-[20px] !rounded-b-[0] flex items-center phone:justify-center gap-[12px] px-[20px] text-[20px] font-[600] relative">
              {t('create_post_title', 'Create Post')}
              <CreationMethodBadge
                creationMethod={existingData?.posts?.[0]?.creationMethod}
                size="sm"
              />
              <button
                type="button"
                onClick={() =>
                  setPhoneTab(phoneTab === 'preview' ? 'edit' : 'preview')
                }
                aria-pressed={phoneTab === 'preview'}
                className={clsx(
                  'hidden phone:flex absolute start-[16px] top-1/2 -translate-y-1/2 items-center gap-[6px] text-[13px] font-[600] rounded-[8px] px-[10px] h-[32px] border',
                  phoneTab === 'preview'
                    ? 'border-sky-400/60 text-sky-300 bg-white/[0.06]'
                    : 'border-white/10 text-[#A3A3A3]'
                )}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"
                    stroke="currentColor"
                    strokeWidth="2"
                  />
                  <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
                </svg>
                {phoneTab === 'preview'
                  ? t('edit_post_tab', 'Edit')
                  : t('preview', 'Preview')}
              </button>
              <button
                type="button"
                aria-label={t('close', 'Close')}
                onClick={askClose}
                className="hidden phone:flex absolute end-[16px] top-1/2 -translate-y-1/2 cursor-pointer text-[#A3A3A3] hover:text-white"
              >
                <CloseIcon />
              </button>
            </div>
            <div
              className={clsx(
                'flex-1 flex flex-col gap-[16px]',
                phoneTab === 'preview' && 'phone:hidden'
              )}
            >
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
                      {/* an existing post keeps its channels */}
                      {!dummy && !existingData.integration && (
                        <SelectCustomer
                          onChange={changeCustomer}
                          integrations={integrations}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-1 gap-[6px] flex-col">
                    <div>
                      {(!existingData.integration ||
                        !!existingData.siblings?.length) && <SelectCurrent />}
                    </div>
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
          <div
            className={clsx(
              'w-[580px] flex flex-col',
              phoneTab === 'preview' ? 'phone:w-full phone:flex-1' : 'phone:hidden'
            )}
          >
            <div className="bg-newBgColor h-[65px] rounded-e-[20px] !rounded-b-[0] flex phone:hidden items-center px-[20px] text-[20px] font-[600]">
              <div className="flex-1">{t('post_preview', 'Post Preview')}</div>
              {/* A real button: the bare icon had no name and no keyboard
                  access, and Escape is off in this modal. */}
              <button
                type="button"
                aria-label={t('close', 'Close')}
                onClick={askClose}
                className="cursor-pointer"
              >
                <CloseIcon className="text-[#A3A3A3]" />
              </button>
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
            <DatePicker onChange={setPickerDate} date={pickerDate} />
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
                  {t('save_as_draft', 'Save as draft')}
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
                      ? t('add_to_calendar', 'Add to Calendar')
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
                      {t('post_now', 'Post now')}
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
