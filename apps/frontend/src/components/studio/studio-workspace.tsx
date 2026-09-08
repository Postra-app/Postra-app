'use client';

import { FC, useState } from 'react';
import dynamic from 'next/dynamic';
import clsx from 'clsx';
import {
  StudioIcon,
  StudioIconName,
} from '@gitroom/frontend/components/studio/studio-icons';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const PostDesignEditor = dynamic(
  () => import('@gitroom/frontend/components/design-editor/post-design-editor'),
  { ssr: false }
);

const VideoStudio = dynamic(
  () =>
    import('@gitroom/frontend/components/video-studio/video-studio').then(
      (m) => m.VideoStudio
    ),
  { ssr: false }
);

export type StudioMode = 'graphic' | 'video';

interface StudioWorkspaceProps {
  setMedia: (params: { id: string; path: string }[]) => void;
  closeModal: () => void;
  /**
   * 'composer' shows the editors' "Use in post" action (output flows straight
   * into the post being composed); 'studio' is the standalone workspace where
   * there's no post, so the graphic editor offers save-to-library / download.
   */
  graphicMode?: 'composer' | 'studio';
  loadMediaId?: string;
  initialMode?: StudioMode;
}

/**
 * Graphic | Video toggle hosting both editors behind one entry. Shared by the
 * standalone /studio route and the composer's "Studio" button so the two stay
 * in sync — the only difference is whether output goes to a post or the library.
 *
 * Both editors stay MOUNTED once opened — the inactive one is just hidden.
 * Switching tabs therefore loses nothing: the canvas, a loaded clip, captions
 * in progress all survive a round trip. Re-clicking the active Video tab
 * brings back its goal-picker start screen.
 */
export const StudioWorkspace: FC<StudioWorkspaceProps> = ({
  setMedia,
  closeModal,
  graphicMode = 'composer',
  loadMediaId,
  initialMode = 'graphic',
}) => {
  const t = useT();
  const [mode, setMode] = useState<StudioMode>(initialMode);
  // Video mounts lazily on first visit, then stays alive in the background.
  const [videoVisited, setVideoVisited] = useState(initialMode === 'video');
  // Bumped when the user re-clicks the Video tab while already on it —
  // VideoStudio reacts by showing the goal screen again.
  const [goalsSignal, setGoalsSignal] = useState(0);

  const switchMode = (next: StudioMode) => {
    if (next === 'video') {
      setVideoVisited(true);
      if (mode === 'video') setGoalsSignal((s) => s + 1);
    }
    setMode(next);
  };

  const tabs: { key: StudioMode; label: string; icon: StudioIconName }[] = [
    { key: 'graphic', label: t('studio_tab_graphic', 'Graphics'), icon: 'graphics' },
    { key: 'video', label: t('studio_tab_video', 'Video'), icon: 'video' },
  ];

  return (
    <div className="studio-root dark flex flex-col gap-2 h-full w-full">
      <div className="flex gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchMode(tab.key)}
            title={
              tab.key === 'video' && mode === 'video'
                ? t('studio_tab_video_again', 'Click again for the start screen')
                : undefined
            }
            className={clsx(
              'h-9 px-4 text-sm rounded-lg border transition-colors flex items-center gap-2',
              mode === tab.key
                ? 'bg-newAccent text-[#06222e] font-[600] border-newAccent'
                : 'bg-newColColor text-textColor border-newBorder hover:bg-white/[0.08]'
            )}
          >
            <StudioIcon name={tab.icon} size={16} />
            {tab.label}
          </button>
        ))}
        {/* Studio had no way out to its own documentation, so a user who got
            stuck had to guess that Help even covers it. Opens in a new tab —
            leaving mid-design to read a page would lose the canvas. */}
        <a
          href="/help#studio"
          target="_blank"
          rel="noopener noreferrer"
          title={t('studio_help_hint', 'How Studio works')}
          className="h-9 w-9 flex items-center justify-center text-sm rounded-lg border border-newBorder bg-newColColor text-textColor/70 hover:bg-white/[0.08] hover:text-textColor transition-colors ms-auto"
          aria-label={t('studio_help_hint', 'How Studio works')}
        >
          ?
        </a>
      </div>
      <div className="flex-1 min-h-0 w-full rounded-lg overflow-hidden border border-newBorder">
        <div className={clsx('h-full', mode !== 'graphic' && 'hidden')}>
          <PostDesignEditor
            mode={graphicMode}
            loadMediaId={loadMediaId}
            setMedia={setMedia}
            closeModal={closeModal}
          />
        </div>
        {videoVisited && (
          <div className={clsx('h-full', mode !== 'video' && 'hidden')}>
            <VideoStudio
              setMedia={setMedia}
              closeModal={closeModal}
              mode={graphicMode}
              showGoalsSignal={goalsSignal}
            />
          </div>
        )}
      </div>
    </div>
  );
};
