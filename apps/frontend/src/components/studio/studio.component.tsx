'use client';

import { useSearchParams } from 'next/navigation';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioWorkspace } from './studio-workspace';

// Standalone /studio is a workspace — there's no post to attach to, so
// setMedia/closeModal are no-ops (the editors expose their own save/download).
const noop = () => {};

export const StudioComponent = () => {
  const t = useT();
  const searchParams = useSearchParams();
  const mediaId = searchParams.get('mediaId') ?? undefined;

  return (
    <>
      {/* The drawer links here on a phone, where the canvas is unusable: the
          toolbar, the inspector and the format bar all need width the screen
          does not have. Say so instead of handing over a broken editor.
          CSS-only so it survives server rendering — a width check in JS would
          flash the wrong branch on first paint. */}
      <div className="hidden phone:flex flex-col items-center justify-center gap-2 text-center px-6 py-16">
        <div className="text-2xl">🎨</div>
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
      <div className="flex-1 min-h-0 w-full phone:hidden">
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
