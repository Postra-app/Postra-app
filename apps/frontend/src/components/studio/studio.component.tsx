'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioWorkspace } from './studio-workspace';

// Standalone /studio is a workspace — there's no post to attach to, so
// setMedia/closeModal are no-ops (the editors expose their own save/download).
const noop = () => {};

// the shell's own bottom padding, so the editor stops short of the edge
const SHELL_GUTTER = 14;
// below this the editor is unusable anyway; let the page scroll instead
const MIN_EDITOR_HEIGHT = 420;

export const StudioComponent = () => {
  const t = useT();
  const searchParams = useSearchParams();
  const mediaId = searchParams.get('mediaId') ?? undefined;
  const hostRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();

  // The editor has to be told how tall it is: it fills the height it is given
  // and scrolls the canvas inside, so with an `auto` height it grows to the
  // canvas instead and the format bar ends up below the fold.
  //
  // A fixed `100vh - 110px` was the old answer, but it assumes nothing sits
  // above Studio. The impersonation and announcement banners both do, and on
  // launch day the announcement banner is on. Measure the gap instead.
  const measure = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    setHeight(Math.max(MIN_EDITOR_HEIGHT, window.innerHeight - top - SHELL_GUTTER));
  }, []);

  useEffect(() => {
    measure();
    // A banner does not resize us, it moves us down, and no observer reports
    // "an ancestor got taller". Watch the two things that actually change: the
    // body's height, and the shell adding or removing a banner element.
    const resize = new ResizeObserver(measure);
    resize.observe(document.body);
    const shell = hostRef.current?.closest('.min-h-screen');
    const mutation = shell
      ? new MutationObserver(measure)
      : undefined;
    if (shell && mutation) mutation.observe(shell, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    return () => {
      resize.disconnect();
      mutation?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  return (
    <>
      {/* The drawer links here on a phone, where the canvas is unusable: the
          toolbar, the inspector and the format bar all need width the screen
          does not have. Say so instead of handing over a broken editor.
          CSS-only so it survives server rendering — a width check in JS would
          flash the wrong branch on first paint. */}
      <div className="hidden phone:flex flex-col items-center justify-center gap-2 text-center px-6 py-16">

        <div className="text-sm font-semibold text-textColor">
          {t('studio_desktop_only_title', 'Studio needs a bigger screen')}
        </div>
        <p className="text-xs text-textColor/60 max-w-[280px]">
          {t(
            'studio_desktop_only_body',
            'The editor needs room for the canvas, the tools and the format bar. Open Postra on a laptop or desktop to use it — everything else works fine here.'
          )}
        </p>
      </div>
      <div
        ref={hostRef}
        style={height ? { height } : undefined}
        className="w-full phone:hidden"
      >
        <StudioWorkspace
          setMedia={noop}
          closeModal={noop}
          graphicMode="studio"
          loadMediaId={mediaId}
        />
      </div>
    </>
  );
};
