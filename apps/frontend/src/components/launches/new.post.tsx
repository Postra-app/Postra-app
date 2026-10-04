import React, { useCallback, useEffect } from 'react';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import dayjs from 'dayjs';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCalendar } from '@gitroom/frontend/components/launches/calendar.context';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { safeJsonParse } from '@gitroom/helpers/utils/safe.json.parse';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { SetSelectionModal } from '@gitroom/frontend/components/launches/calendar';
import dynamic from 'next/dynamic';
// Composer pulls ~13 @tiptap packages + Uppy + CopilotPopup — load it only
// when the modal actually opens instead of shipping it with the page bundle.
const AddEditModal = dynamic(
  () =>
    import('@gitroom/frontend/components/new-launch/add.edit.modal').then(
      (mod) => mod.AddEditModal
    ),
  { ssr: false }
);
import { ModalWrapperComponent } from '@gitroom/frontend/components/new-launch/modal.wrapper.component';

// NewPost mounts twice on /launches (sidebar + mobile header) and React
// strict-mode re-runs effects, so each ?newPostMedia deep link from Studio
// must be consumed exactly once (every Studio export mints fresh media ids,
// so comparing the raw value is enough).
let lastConsumedNewPostMedia: string | null = null;

export const NewPost = () => {
  const fetch = useFetch();
  const modal = useModals();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { integrations, reloadCalendarView, composerDefaults } = useCalendar();
  const t = useT();

  const createAPost = useCallback(async (
    initialMedia?: { id: string; path: string }[]
  ) => {
    const [{ date }, { sets, signature }] = await Promise.all([
      fetch('/posts/find-slot').then((res) => res.json()),
      composerDefaults(),
    ]);

    // Media arriving from Studio pre-fills the post (onlyValues), which takes
    // precedence over a set's content — asking for a set would be misleading.
    const set: any = !sets.length || initialMedia?.length
      ? undefined
      : await new Promise((resolve) => {
          modal.openModal({
            title: t('select_set', 'Select a Set'),
            closeOnClickOutside: true,
            closeOnEscape: true,
            withCloseButton: false,
            onClose: () => resolve('exit'),
            classNames: {
              modal: 'text-textColor',
            },
            children: (
              <SetSelectionModal
                sets={sets}
                onSelect={(selectedSet) => {
                  resolve(selectedSet);
                  modal.closeAll();
                }}
                onContinueWithoutSet={() => {
                  resolve(undefined);
                  modal.closeAll();
                }}
              />
            ),
          });
        });

    if (set === 'exit') return;

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
          allIntegrations={integrations.map((p) => ({
            ...p,
          }))}
          {...(set?.content ? { set: safeJsonParse<any>(set.content, undefined) } : {})}
          {...(initialMedia?.length || (signature?.id && !set)
            ? {
                // The auto-add signature, as a click on a calendar cell
                // already did; this button (the main way in) skipped it.
                onlyValues: [
                  {
                    content: signature?.id && !set ? '\n' + signature.content : '',
                    ...(initialMedia?.length ? { image: initialMedia } : {}),
                  },
                ],
              }
            : {})}
          reopenModal={createAPost}
          mutate={reloadCalendarView}
          integrations={integrations}
          date={dayjs.utc(date).local()}
        />
      ),
      size: '80%',
      title: ``,
    });
  }, [integrations, composerDefaults]);

  // Studio's "Use in post" lands here: /launches?newPostMedia=[{id,path},…]
  // → open the new-post modal with the exported graphic(s) pre-attached.
  useEffect(() => {
    const raw = searchParams.get('newPostMedia');
    if (!raw || lastConsumedNewPostMedia === raw) return;
    lastConsumedNewPostMedia = raw;
    const media = safeJsonParse<{ id: string; path: string }[]>(raw, []);
    router.replace('/launches');
    if (media?.length) {
      createAPost(media);
    }
  }, [searchParams]);

  return (
    <button
      onClick={() => createAPost()}
      className="text-[#0a0e1a] flex-1 pt-[12px] pb-[14px] ps-[16px] pe-[20px] group-[.sidebar]:p-0 min-h-[46px] max-h-[46px] rounded-[14px] border border-sky-300/20 bg-[linear-gradient(135deg,#38bdf8,#a78bfa)] shadow-[0_18px_40px_rgba(56,189,248,0.22)] flex justify-center items-center gap-[5px] outline-none transition-all hover:-translate-y-[1px] hover:shadow-[0_24px_60px_rgba(56,189,248,0.28)]"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="21"
        height="20"
        viewBox="0 0 21 20"
        fill="none"
        className="min-w-[21px] min-h-[20px]"
      >
        <path
          d="M10.5001 4.16699V15.8337M4.66675 10.0003H16.3334"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="flex-1 phone:flex-none phone:text-center text-[14px] font-[700] group-[.sidebar]:hidden">
        {t('create_new_post', 'Create post')}
      </div>
    </button>
  );
};
