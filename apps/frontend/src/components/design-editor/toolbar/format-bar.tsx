'use client';

import { FC } from 'react';
import { useEditorStore, PLATFORM_SIZES } from '../editor.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';

export const FormatBar: FC = () => {
  const { platform, setPlatform } = useEditorStore();
  const t = useT();

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-newBorder bg-white/[0.03]">
      <span className="text-[11px] text-textColor/60 uppercase tracking-wide mr-2">
        {t('format', 'Format')}:
      </span>
      <div className="flex gap-1 flex-wrap">
        {PLATFORM_SIZES.filter((p) => p.key !== 'custom').map((size) => (
          <button
            key={size.key}
            onClick={() => setPlatform(size)}
            className={clsx(
              'px-2 py-1 text-[11px] rounded transition-colors',
              platform.key === size.key
                ? 'bg-newAccent text-[#06222e] font-[600]'
                : 'bg-newColColor text-textColor hover:bg-white/[0.08]'
            )}
          >
            {size.label}
          </button>
        ))}
      </div>
      <span className="ml-auto text-[11px] text-textColor/65">
        {platform.width}×{platform.height}px
      </span>
    </div>
  );
};
