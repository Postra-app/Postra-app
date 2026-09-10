'use client';

import { FC, useEffect, useRef } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFocusTrap } from '@gitroom/frontend/components/ui/use-focus-trap';

/**
 * The shortcuts exist and are worth knowing, but nothing on screen said so.
 * "?" is where every editor keeps this list, so that is where ours lives.
 */
const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

type Row = { keys: string; labelKey: string; fallback: string };

const GROUPS: { titleKey: string; titleFallback: string; rows: Row[] }[] = [
  {
    titleKey: 'shortcuts_group_tools',
    titleFallback: 'Tools',
    rows: [
      { keys: 'V', labelKey: 'tool_select', fallback: 'Select' },
      { keys: 'T', labelKey: 'tool_text', fallback: 'Text' },
      { keys: 'R', labelKey: 'tool_shapes', fallback: 'Shapes' },
      { keys: 'I', labelKey: 'tool_icons', fallback: 'Icons' },
      { keys: 'L', labelKey: 'tool_layers', fallback: 'Layers' },
    ],
  },
  {
    titleKey: 'shortcuts_group_objects',
    titleFallback: 'Objects',
    rows: [
      { keys: `${MOD}+C`, labelKey: 'shortcut_copy', fallback: 'Copy' },
      { keys: `${MOD}+V`, labelKey: 'shortcut_paste', fallback: 'Paste' },
      {
        keys: `${MOD}+D`,
        labelKey: 'shortcut_duplicate',
        fallback: 'Duplicate',
      },
      {
        keys: `${MOD}+A`,
        labelKey: 'shortcut_select_all',
        fallback: 'Select everything',
      },
      { keys: 'Delete', labelKey: 'shortcut_delete', fallback: 'Delete' },
      { keys: 'Esc', labelKey: 'shortcut_deselect', fallback: 'Deselect' },
      {
        keys: '← ↑ → ↓',
        labelKey: 'shortcut_nudge',
        fallback: 'Move by 1px (hold Shift for 10px)',
      },
    ],
  },
  {
    titleKey: 'shortcuts_group_canvas',
    titleFallback: 'Canvas',
    rows: [
      { keys: `${MOD}+Z`, labelKey: 'shortcut_undo', fallback: 'Undo' },
      {
        keys: `${MOD}+Shift+Z`,
        labelKey: 'shortcut_redo',
        fallback: 'Redo',
      },
      {
        keys: `${MOD}+scroll`,
        labelKey: 'shortcut_zoom',
        fallback: 'Zoom in and out',
      },
    ],
  },
];

export const ShortcutsSheet: FC<{ open: boolean; onClose: () => void }> = ({
  open,
  onClose,
}) => {
  const t = useT();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Tab used to walk out of the dialog into the page behind it.
  useFocusTrap(dialogRef, open);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previousActive = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previousActive?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-shortcuts-title"
    >
      <div
        className="relative w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto bg-[rgba(15,23,42,0.92)] backdrop-blur-xl rounded-lg shadow-2xl border border-newBorder p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2
            id="studio-shortcuts-title"
            className="text-[18px] font-[600] text-textColor"
          >
            {t('shortcuts_title', 'Keyboard shortcuts')}
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="text-textColor/60 hover:text-textColor transition-colors text-sm"
          >
            {t('close', 'Close')}
          </button>
        </div>

        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <div key={group.titleKey} className="flex flex-col gap-2">
              <span className="text-[11px] uppercase tracking-wide text-textColor/60">
                {t(group.titleKey, group.titleFallback)}
              </span>
              {group.rows.map((row) => (
                <div
                  key={row.keys}
                  className="flex items-center justify-between gap-4 text-[13px] text-textColor"
                >
                  <span>{t(row.labelKey, row.fallback)}</span>
                  <kbd className="shrink-0 px-2 py-1 rounded bg-newColColor text-[12px] text-textColor/80 border border-newBorder">
                    {row.keys}
                  </kbd>
                </div>
              ))}
            </div>
          ))}
        </div>

        <p className="mt-5 text-[11px] text-textColor/60">
          {t('shortcuts_hint', 'Press ? at any time to open this list.')}
        </p>
      </div>
    </div>
  );
};
