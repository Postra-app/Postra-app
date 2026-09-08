'use client';

import { FC, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useMediaDirectory } from '@gitroom/react/helpers/use.media.directory';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/frontend/components/ui/button';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { VideoTrimmer } from './video-trimmer';
import { VideoMultiFormat, VideoFormat } from './video-multi-format';
import { VideoCaptions } from './video-captions';
import { VideoStock } from './video-stock';
import { VideoTextOverlay } from './video-text-overlay';
import { VideoSlideshow } from './video-slideshow';
import { VideoLibraryPicker, LibraryMedia } from './video-library-picker';
import {
  fetchLibraryVideoAsFile,
  VideoTooLargeError,
  assertVideoSize,
} from './load-library-media';
import { ensureMp4, isMp4 } from './mp4-source';
import { UnsupportedCodecError } from './compositor-pipeline';

// Extensions worth trying when the browser hands us a useless MIME type.
const VIDEO_EXTENSION = /\.(mp4|m4v|mov|webm|mkv|avi|qt)$/i;

interface VideoStudioProps {
  setMedia: (params: { id: string; path: string }[]) => void;
  closeModal: () => void;
  /** 'composer' delivers output into the open post; 'studio' (standalone
   *  /studio, where setMedia is a no-op) carries it into a fresh post on
   *  /launches — the same newPostMedia bridge the graphics editor uses. */
  mode?: 'composer' | 'studio';
  /** Bumped by the host when the user re-clicks the Video tab — show the
   *  goal-picker start screen again (state and clip stay untouched). */
  showGoalsSignal?: number;
}

type Tab = 'trim' | 'formats' | 'captions' | 'stock' | 'text' | 'slideshow';

/** Why an upload produced no media row — each reason gets its own message. */
type UploadFailure = 'too_large' | 'rejected' | 'network';
/**
 * Deliberately a plain record rather than a discriminated union: this repo
 * compiles with `strictNullChecks: false` (tsconfig.base.json), and that turns
 * off narrowing on a boolean discriminant — `if (!result.ok)` would still see
 * the success member and refuse to read `reason`.
 */
type UploadResult = {
  media: { id: string; path: string } | null;
  reason: UploadFailure | null;
};

export const VideoStudio: FC<VideoStudioProps> = ({
  setMedia,
  closeModal,
  mode = 'composer',
  showGoalsSignal = 0,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const router = useRouter();
  const mediaDirectory = useMediaDirectory();

  // Every export path funnels through here. In the composer the media lands
  // in the open post; standalone /studio has no post to attach to, so carry
  // it into a fresh post on /launches instead of dead-ending at Download.
  /**
   * What standalone Studio produced, waiting for the user to say where it goes.
   *
   * Every output used to navigate straight to the calendar the moment it was
   * ready — no preview, no choice, and no way back to the clip you were still
   * working on. On an organisation with no channels connected that landed you
   * on an empty calendar whose only response is "Add channel", with the file
   * apparently gone. It is already saved to the library by this point, so the
   * honest options are "use it now" or "carry on".
   */
  const [delivered, setDelivered] = useState<
    { id: string; path: string }[] | null
  >(null);

  const deliver = useCallback(
    (uploaded: { id: string; path: string }[]) => {
      if (mode === 'studio') {
        setDelivered(uploaded);
        return;
      }
      setMedia(uploaded);
      closeModal();
    },
    [mode, setMedia, closeModal]
  );

  const useDeliveredInPost = useCallback(() => {
    if (!delivered) return;
    router.push(
      `/launches?newPostMedia=${encodeURIComponent(JSON.stringify(delivered))}`
    );
  }, [delivered, router]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** In-flight upload, shared so a double click can't start a second one. */
  const uploadPromiseRef = useRef<Promise<{ id: string; path: string } | null> | null>(null);
  const user = useUser();
  const orgIdRef = useRef('default');
  orgIdRef.current = user?.orgId || 'default';

  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<File | null>(null);
  const [trimmedBlob, setTrimmedBlob] = useState<Blob | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<{ id: string; path: string } | null>(null);
  const [tab, setTab] = useState<Tab>('trim');
  const [isUploading, setIsUploading] = useState(false);
  // Remuxing a MOV/WebM source into MP4 before upload takes long enough on a
  // phone-sized clip to need its own line in the status bar.
  const [isConverting, setIsConverting] = useState(false);
  const [browserSupported, setBrowserSupported] = useState(true);
  const [showLibrary, setShowLibrary] = useState(false);
  const [isImportingLibrary, setIsImportingLibrary] = useState(false);
  // Goal-based start screen: tools are tabs, but users think in outcomes
  // ("photos → Reels"), so the content area opens on goals until one is
  // picked (or a tab is clicked directly). 🎯 in the header brings it back.
  const [showGoals, setShowGoals] = useState(true);
  // A goal that needs a clip first (captions) is parked here until the file
  // the user just picked lands in state.
  const [pendingGoal, setPendingGoal] = useState<Tab | null>(null);
  const [lastGoal, setLastGoal] = useState<Tab | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('postra:video-last-goal');
      if (saved) setLastGoal(saved as Tab);
    } catch {
      // private mode — no memory of the last goal, nothing breaks
    }
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof (window as unknown as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') {
      setBrowserSupported(false);
    }
  }, []);

  useEffect(() => {
    if (showGoalsSignal > 0) setShowGoals(true);
  }, [showGoalsSignal]);

  fileRef.current = file;

  // The restore below runs across two awaits; these mirrors let it ask "is the
  // user still waiting for this clip, or did they walk off and start something
  // else?" without re-running the effect.
  const showGoalsRef = useRef(showGoals);
  showGoalsRef.current = showGoals;
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** Tabs that edit the one shared source clip (the others bring their own). */
  const SHARED_CLIP_TABS: Tab[] = ['trim', 'formats', 'captions'];
  const wantsSharedClip = () =>
    showGoalsRef.current || SHARED_CLIP_TABS.includes(tabRef.current);

  // Remember the last library-backed clip (per org) so leaving the page and
  // coming back doesn't lose the session. A from-disk file that was never
  // uploaded can't survive a page unload — it gets covered the moment any
  // action uploads it (save to library, captions, use in post).
  const videoDraftKey = () => `postra:video-draft:${orgIdRef.current}`;
  useEffect(() => {
    if (!uploadedMedia) return;
    try {
      window.localStorage.setItem(videoDraftKey(), JSON.stringify(uploadedMedia));
    } catch {
      // private mode / quota — persistence is best-effort
    }
  }, [uploadedMedia]);

  // Coming back to Studio should show the clip you were editing, not an empty
  // "choose a file" screen. Restore once per mount, only if the user hasn't
  // loaded anything themselves — the download takes seconds, so re-check
  // after every await and keep a visible "restoring" state the whole time.
  const restoreAttemptedRef = useRef(false);
  const [restoringClip, setRestoringClip] = useState(false);
  useEffect(() => {
    if (!user || restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    let draft: { id?: string } | null = null;
    try {
      draft = JSON.parse(window.localStorage.getItem(videoDraftKey()) || 'null');
    } catch {
      return;
    }
    if (!draft?.id) return;
    (async () => {
      setRestoringClip(true);
      try {
        const media = await (await fetch(`/media/${draft.id}`)).json();
        if (!media?.path) throw new Error('deleted');
        if (fileRef.current) return;
        // Don't spend a 200 MB download on someone who opened Studio to build a
        // slideshow or browse stock — those tabs never touch the shared clip.
        if (!wantsSharedClip()) return;
        const loaded = await fetchLibraryVideoAsFile(mediaDirectory.set(media.path));
        if (fileRef.current) return; // user loaded their own clip meanwhile
        if (!wantsSharedClip()) return;
        setFile(loaded);
        setTrimmedBlob(null);
        setUploadedMedia({ id: draft.id!, path: media.path });
        // Taking over the screen is only welcome while the user is still on the
        // goal picker. Doing it after they picked "Photos → video" unmounted
        // that tab and threw away the photos they had already added.
        if (showGoalsRef.current) {
          setTab('trim');
          setShowGoals(false);
        }
        toaster.show(t('video_clip_restored', 'Restored the clip from your last session.'), 'success');
      } catch {
        // The clip was deleted from the library (or is too big) — forget it.
        try {
          window.localStorage.removeItem(videoDraftKey());
        } catch {
          // private mode — nothing to clear
        }
      } finally {
        setRestoringClip(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    // Clear the input straight away: without this, picking the SAME file again
    // after a failed step fires no change event and looks like a dead button.
    e.target.value = '';
    if (!f) return;
    // Same trap as the photo picker: a .mov or .mp4 can arrive with a generic
    // application/octet-stream, and judging on MIME alone told the user to
    // "choose a video file (MP4, WebM, MOV)" about the MOV they had just
    // chosen. Accept it by extension too and let the decoder be the judge -
    // an undecodable clip is reported properly further down the line.
    if (!f.type.startsWith('video/') && !VIDEO_EXTENSION.test(f.name)) {
      toaster.show(t('video_bad_type', 'Choose a video file (MP4, WebM, MOV).'), 'warning');
      return;
    }
    try {
      assertVideoSize(f);
    } catch {
      toaster.show(
        t('video_disk_too_big', 'File is too large to edit in the browser (200 MB limit).'),
        'warning'
      );
      return;
    }
    setFile(f);
    setTrimmedBlob(null);
    setUploadedMedia(null);
    setTab('trim');
  };

  const loadFromLibrary = useCallback(
    async (media: LibraryMedia) => {
      setIsImportingLibrary(true);
      try {
        const loaded = await fetchLibraryVideoAsFile(mediaDirectory.set(media.path));
        setFile(loaded);
        setTrimmedBlob(null);
        // It already lives in the library, so remember its id/path — "Użyj w
        // poście" and captions can then skip re-uploading the same bytes.
        setUploadedMedia({ id: media.id, path: media.path });
        setTab('trim');
        setShowLibrary(false);
        // Picking from the library can happen while the goals screen is up —
        // without this the clip loads invisibly "underneath" it.
        setShowGoals(false);
      } catch (e) {
        toaster.show(
          e instanceof VideoTooLargeError
            ? t(
                'video_library_too_big',
                'This clip is too large to edit in the browser (200 MB limit). Use a shorter one.'
              )
            : t('video_library_load_failed', 'Failed to load the video from the library.'),
          'warning'
        );
      } finally {
        setIsImportingLibrary(false);
      }
    },
    [mediaDirectory, toaster, t]
  );

  /** Turn an upload failure into the one sentence that tells the user what to do. */
  const reportUploadFailure = useCallback(
    (reason: UploadFailure) => {
      toaster.show(
        reason === 'too_large'
          ? t(
              'video_upload_too_large',
              'The rendered clip is too big to upload. Trim it shorter, or export a smaller section, and try again.'
            )
          : reason === 'rejected'
          ? t(
              'video_upload_rejected',
              "The server didn't accept that file. Trim the clip first — that re-saves it as a standard MP4."
            )
          : t('video_upload_failed', 'Upload failed.'),
        'warning'
      );
    },
    [toaster, t]
  );

  const uploadBlob = useCallback(
    async (blob: Blob, name: string): Promise<UploadResult> => {
      const formData = new FormData();
      formData.append('file', blob, name);
      try {
        const res = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        // 413 comes back from the gateway as HTML, so read the status before
        // touching the body — .json() on it throws and used to surface as a
        // generic failure with no hint that the file was simply too big.
        if (!res.ok) {
          return {
            media: null,
            reason: res.status === 413 ? 'too_large' : 'rejected',
          };
        }
        const data = await res.json();
        return data?.id && data?.path
          ? { media: { id: data.id, path: data.path }, reason: null }
          : { media: null, reason: 'rejected' };
      } catch {
        return { media: null, reason: 'network' };
      }
    },
    [fetch]
  );

  const handleTrimmedExport = useCallback(
    async (blob: Blob) => {
      setTrimmedBlob(blob);
      setUploadedMedia(null);
      // The render finishing at 100% and then going quiet read as "nothing
      // happened" — say out loud that the clip is ready and where to go next.
      toaster.show(
        t(
          'video_trimmed_ready',
          'Trimmed clip ready — save it to your library or use it in a post with the buttons below.'
        ),
        'success'
      );
    },
    [toaster, t]
  );

  // Upload whatever clip is loaded — the trimmed version if present, otherwise
  // the original source — so captions don't force a trim first. Reports its own
  // failures (with the reason), so callers only have to check for null.
  const ensureUploaded = useCallback(async (): Promise<{ id: string; path: string } | null> => {
    if (uploadedMedia) return uploadedMedia;
    // Two clicks on "AI Captions" used to start two uploads and leave two rows
    // in the library; share the in-flight one instead.
    if (uploadPromiseRef.current) return uploadPromiseRef.current;
    const source = trimmedBlob ?? file;
    if (!source) return null;

    const run = (async (): Promise<{ id: string; path: string } | null> => {
      let blob = source;
      // The upload endpoint takes MP4 and nothing else, while the editor opens
      // MOV/WebM happily — remux (a container rewrite, no re-encode) so a clip
      // straight off a phone doesn't dead-end at "Upload failed".
      if (!isMp4(source)) {
        setIsConverting(true);
        try {
          blob = await ensureMp4(source);
        } catch (err) {
          toaster.show(
            err instanceof UnsupportedCodecError
              ? t(
                  'clip_codec_unsupported',
                  "This clip's video format can't be decoded by your browser (often HEVC/H.265 from a phone). Re-export it as a standard MP4 (H.264) and try again."
                )
              : t(
                  'video_convert_failed',
                  "Couldn't convert this clip to MP4. Re-export it as a standard MP4 (H.264) and try again."
                ),
            'warning'
          );
          return null;
        } finally {
          setIsConverting(false);
        }
      }

      setIsUploading(true);
      const result = await uploadBlob(blob, `clip-${Date.now()}.mp4`);
      setIsUploading(false);
      if (!result.media) {
        reportUploadFailure(result.reason ?? 'network');
        return null;
      }
      setUploadedMedia(result.media);
      return result.media;
    })();

    uploadPromiseRef.current = run;
    try {
      return await run;
    } finally {
      uploadPromiseRef.current = null;
    }
  }, [uploadedMedia, trimmedBlob, file, uploadBlob, reportUploadFailure, toaster, t]);

  const handleSwitchToCaptions = useCallback(async () => {
    if (!uploadedMedia && !trimmedBlob && !file) {
      toaster.show(
        t('video_upload_first', 'Load a video first (From disk / From library).'),
        'warning'
      );
      return;
    }
    // A clip IS loaded, so any failure here is the upload's — and ensureUploaded
    // has already said which one. Saying "load a video first" sent users in circles.
    const m = await ensureUploaded();
    if (!m) return;
    setTab('captions');
  }, [uploadedMedia, trimmedBlob, file, ensureUploaded, toaster, t]);

  // Finish a clip-dependent goal once the picked file lands in state.
  useEffect(() => {
    if (!pendingGoal || !file) return;
    if (pendingGoal === 'captions') {
      handleSwitchToCaptions();
    } else {
      setTab(pendingGoal);
    }
    setPendingGoal(null);
  }, [file, pendingGoal, handleSwitchToCaptions]);

  const pickGoal = useCallback(
    (goal: Tab) => {
      setShowGoals(false);
      setLastGoal(goal);
      try {
        window.localStorage.setItem('postra:video-last-goal', goal);
      } catch {
        // private mode — fine
      }
      const hasSource = !!(file || trimmedBlob);
      if (goal === 'captions' && !hasSource) {
        // Captions need a clip — send the user straight to picking one and
        // continue to the captions tab as soon as it loads.
        setPendingGoal('captions');
        setTab('trim');
        fileInputRef.current?.click();
        return;
      }
      if (goal === 'captions') {
        handleSwitchToCaptions();
        return;
      }
      setTab(goal);
      if (goal === 'trim' && !hasSource) {
        fileInputRef.current?.click();
      }
    },
    [file, trimmedBlob, handleSwitchToCaptions]
  );

  const handleUseInPost = useCallback(async () => {
    if (uploadedMedia) {
      deliver([uploadedMedia]);
      return;
    }
    if (!trimmedBlob) return;
    const m = await ensureUploaded();
    if (m) deliver([m]);
  }, [uploadedMedia, trimmedBlob, ensureUploaded, deliver]);

  // "Just save" — upload the trimmed clip to the library and stay here.
  const handleSaveToLibrary = useCallback(async () => {
    const m = await ensureUploaded();
    if (m) {
      toaster.show(
        t('video_saved_to_library', 'Saved to media library — you can use it in any post.'),
        'success'
      );
    }
  }, [ensureUploaded, toaster, t]);

  const handleFormatsExported = useCallback(
    async (results: { format: VideoFormat; blob: Blob }[]) => {
      setIsUploading(true);
      const uploaded: { id: string; path: string }[] = [];
      let failure: UploadFailure | null = null;
      for (const r of results) {
        const result = await uploadBlob(r.blob, `${r.format.key}-${Date.now()}.mp4`);
        if (result.media) uploaded.push(result.media);
        else failure = failure ?? result.reason;
      }
      setIsUploading(false);
      if (uploaded.length) {
        deliver(uploaded);
      } else {
        reportUploadFailure(failure ?? 'network');
      }
    },
    [uploadBlob, deliver, reportUploadFailure]
  );

  const handleCaptionedReady = useCallback(
    (newMedia: { id: string; path: string }) => {
      setUploadedMedia(newMedia);
      deliver([newMedia]);
    },
    [deliver]
  );

  const handleStockImported = useCallback(
    (newMedia: { id: string; path: string }) => {
      deliver([newMedia]);
    },
    [deliver]
  );

  const handleComposedReady = useCallback(
    (newMedia: { id: string; path: string }) => {
      deliver([newMedia]);
    },
    [deliver]
  );

  if (!browserSupported) {
    return (
      <div className="flex flex-col gap-3 p-6">
        <div className="text-sm text-textColor">
          ⚠️{' '}
          {t(
            'video_unsupported_browser',
            'Your browser does not support video editing (WebCodecs). Use Chrome, Edge or Safari 16.4+.'
          )}
        </div>
        <Button onClick={closeModal}>{t('close', 'Close')}</Button>
      </div>
    );
  }

  // Formats/captions work on whatever clip is loaded — no forced trim first.
  const hasClip = !!(file || trimmedBlob);
  const tabs: { key: Tab; label: string; icon: string; needsClip: boolean; onClick?: () => void }[] = [
    { key: 'trim', label: t('video_tab_trim', 'Trim'), icon: '✂', needsClip: false },
    { key: 'formats', label: t('video_tab_formats', 'Formats'), icon: '📐', needsClip: true },
    { key: 'captions', label: t('video_tab_captions', 'AI Captions'), icon: '💬', needsClip: true, onClick: handleSwitchToCaptions },
    { key: 'stock', label: t('video_tab_stock', 'Stock B-roll'), icon: '🎞', needsClip: false },
    { key: 'text', label: t('video_tab_text', 'Text'), icon: '✍️', needsClip: false },
    { key: 'slideshow', label: t('video_tab_slideshow', 'Photos → video'), icon: '🖼', needsClip: false },
  ];

  return (
    <div className="flex flex-col h-full bg-white/[0.03] rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-newBorder">
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setShowGoals(true)}
            title={t('video_goals_back', 'What do you want to make? — back to goals')}
            className={`text-xs px-2 py-1 rounded transition-colors ${
              showGoals
                ? 'bg-newAccent text-white'
                : 'bg-newColColor text-textColor hover:bg-forth'
            }`}
          >
            🎯
          </button>
          {tabs.map((tDef) => (
            <button
              key={tDef.key}
              onClick={() => {
                setShowGoals(false);
                if (tDef.onClick) tDef.onClick();
                else setTab(tDef.key);
              }}
              disabled={(tDef.needsClip && !hasClip) || isUploading || isConverting}
              className={`text-xs px-3 py-1 rounded transition-colors ${
                tab === tDef.key && !showGoals
                  ? 'bg-newAccent text-white'
                  : 'bg-newColColor text-textColor hover:bg-forth'
              } disabled:opacity-40`}
            >
              {tDef.icon} {tDef.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="text-xs px-3 py-1 rounded bg-newColColor text-textColor hover:bg-forth transition-colors"
          >
            📁 {t('video_source_disk', 'From disk')}
          </button>
          <button
            onClick={() => setShowLibrary(true)}
            className="text-xs px-3 py-1 rounded bg-newColColor text-textColor hover:bg-forth transition-colors"
          >
            🗂 {t('video_source_library', 'From library')}
          </button>
        </div>
      </div>

      {(isUploading || restoringClip || isImportingLibrary || isConverting) && (
        <div className="px-4 py-1.5 bg-forth/10 border-b border-forth/30 text-xs text-textColor">
          ⏳{' '}
          {restoringClip
            ? t('video_restoring_clip', 'Restoring the clip from your last session…')
            : isImportingLibrary
            ? t('video_importing_clip', 'Loading the clip from your library…')
            : isConverting
            ? t('video_converting_clip', 'Converting the clip to MP4 — keep this page open…')
            : t('video_uploading_clip', 'Uploading the clip — keep this page open…')}
        </div>
      )}

      {delivered && (
        <div className="flex items-center gap-2 flex-wrap px-3 py-2 rounded-lg bg-forth/15 border border-forth/40 text-xs text-textColor">
          <span className="flex-1 min-w-[180px]">
            ✅{' '}
            {t(
              'video_result_saved',
              'Saved to your media library — use it now or keep working.'
            )}
          </span>
          <button
            onClick={useDeliveredInPost}
            className="px-3 py-1 rounded bg-newAccent text-white hover:opacity-90 transition-opacity"
          >
            {t('video_result_use', 'Use in post')} →
          </button>
          <button
            onClick={() => setDelivered(null)}
            className="px-3 py-1 rounded bg-newColColor text-textColor hover:bg-forth transition-colors"
          >
            {t('video_result_stay', 'Keep working')}
          </button>
        </div>
      )}

      <div className="flex-1 overflow-auto relative">
        {showLibrary && (
          <div className="absolute inset-0 z-[20]">
            <VideoLibraryPicker
              onPick={loadFromLibrary}
              onClose={() => setShowLibrary(false)}
              busy={isImportingLibrary}
            />
          </div>
        )}
        {showGoals && (
          <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
            <div className="text-sm font-semibold text-textColor">
              {t('video_goals_title', 'What do you want to make?')}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-[560px]">
              {(
                [
                  { goal: 'slideshow' as Tab, icon: '📸', label: t('video_goal_slideshow', 'Photos → Reels'), desc: t('video_goal_slideshow_desc', 'Turn a few photos into a video with motion') },
                  { goal: 'trim' as Tab, icon: '✂', label: t('video_goal_trim', 'Trim a video'), desc: t('video_goal_trim_desc', 'Cut a clip to the right length') },
                  { goal: 'captions' as Tab, icon: '💬', label: t('video_goal_captions', 'Add captions'), desc: t('video_goal_captions_desc', 'AI transcribes and burns in subtitles') },
                  { goal: 'text' as Tab, icon: '🅰', label: t('video_goal_text', 'Text on video'), desc: t('video_goal_text_desc', 'Overlay your message in brand style') },
                  { goal: 'stock' as Tab, icon: '🎞', label: t('video_goal_stock', 'Find stock B-roll'), desc: t('video_goal_stock_desc', 'Free clips to post or mix in') },
                  // Formats had a tab but no card, so the one job people arrive
                  // with — "I have a clip, I need it in the shape this platform
                  // wants" — was the only one this screen never offered.
                  { goal: 'formats' as Tab, icon: '📐', label: t('video_goal_formats', 'Resize for platforms'), desc: t('video_goal_formats_desc', 'One clip, re-framed for Reels, TikTok, Feed') },
                ]
              ).map((g) => (
                <button
                  key={g.goal}
                  onClick={() => pickGoal(g.goal)}
                  className="relative text-left p-3 rounded-lg bg-newColColor hover:bg-forth hover:text-white text-textColor transition-colors group"
                >
                  <div className="text-sm font-semibold">
                    {g.icon} {g.label}
                  </div>
                  <div className="text-[11px] text-textColor/60 group-hover:text-white/70 mt-0.5">
                    {g.desc}
                  </div>
                  {lastGoal === g.goal && (
                    <span className="absolute top-1.5 right-2 text-[9px] uppercase tracking-wide text-textColor/40 group-hover:text-white/60">
                      {t('video_goal_last', 'last used')}
                    </span>
                  )}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-textColor/40 text-center">
              {t('video_goals_hint', 'Same tools as the tabs above — this is just the quickest way in.')}
              <br />
              {t('video_goals_free', 'Every tool here is included on all plans.')}
            </div>
          </div>
        )}
        {!showGoals && tab === 'trim' && (
          <VideoTrimmer file={file} onTrimmed={handleTrimmedExport} />
        )}
        {!showGoals && tab === 'formats' && (
          <VideoMultiFormat source={trimmedBlob ?? file} onExported={handleFormatsExported} />
        )}
        {!showGoals && tab === 'captions' && (
          <VideoCaptions
            mediaId={uploadedMedia?.id ?? null}
            source={trimmedBlob ?? file}
            onCaptioned={handleCaptionedReady}
          />
        )}
        {!showGoals && tab === 'stock' && (
          <VideoStock onImported={handleStockImported} />
        )}
        {!showGoals && tab === 'text' && <VideoTextOverlay onReady={handleComposedReady} />}
        {!showGoals && tab === 'slideshow' && <VideoSlideshow onReady={handleComposedReady} />}
      </div>

      {trimmedBlob && !showGoals && tab === 'trim' && (
        <div className="px-4 py-2 border-t border-newBorder flex items-center justify-between gap-2">
          <div className="text-[11px] text-textColor/60">
            {t('video_trim_done', 'Trimmed. Continue to pick formats or use the single file.')}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleSaveToLibrary}
              disabled={isUploading}
              className="text-xs px-3 h-[28px] rounded bg-newColColor text-textColor hover:bg-forth transition-colors disabled:opacity-50"
            >
              💾 {isUploading ? t('saving', 'Saving…') : t('save_to_library_btn', 'Save to library')}
            </button>
            <Button
              loading={isUploading}
              onClick={handleUseInPost}
              className="!h-[28px] !text-xs"
            >
              {t('video_use_in_post', 'Use in post')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
