'use client';

import { FC, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { StudioIcon, StudioIconName } from '@gitroom/frontend/components/studio/studio-icons';

export type ExportMenuItem = {
  key: string;
  icon: StudioIconName;
  label: string;
  hint?: string;
  disabled?: boolean;
  onSelect: () => void;
};

/**
 * The action bar used to carry four identical grey chips next to one real
 * button, and wrapped onto a second row at laptop widths - eating the canvas
 * to show four things a user picks at the end, not while designing.
 *
 * They live behind one control now, so the bar has a single primary action.
 */
export const ExportMenu: FC<{ label: string; items: ExportMenuItem[] }> = ({
  label,
  items,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={clsx(
          'h-8 px-3 text-xs rounded flex items-center gap-1.5 transition-colors',
          open
            ? 'bg-white/[0.10] text-textColor'
            : 'bg-newColColor text-textColor hover:bg-white/[0.08]'
        )}
      >
        <StudioIcon name="download" size={15} />
        {label}
        <span aria-hidden className="opacity-60">▾</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 top-[calc(100%+6px)] z-[40] min-w-[232px] rounded-[10px] border border-newBorder bg-[rgba(15,23,42,0.97)] backdrop-blur-xl shadow-[0_24px_80px_rgba(2,6,23,0.45)] p-1"
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="w-full flex items-start gap-2.5 px-2.5 py-2 rounded-[6px] text-start text-textColor hover:bg-white/[0.08] disabled:opacity-50 transition-colors"
            >
              <span className="mt-[1px] shrink-0">
                <StudioIcon name={item.icon} size={15} />
              </span>
              <span className="flex flex-col">
                <span className="text-xs">{item.label}</span>
                {item.hint && (
                  <span className="text-[11px] text-textColor/60">{item.hint}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
