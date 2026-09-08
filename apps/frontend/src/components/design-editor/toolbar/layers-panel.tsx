'use client';

import { FC, MutableRefObject, useCallback, useEffect, useState } from 'react';
import * as fabric from 'fabric';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioIcon, StudioIconName } from '@gitroom/frontend/components/studio/studio-icons';

type Row = {
  object: fabric.FabricObject;
  label: string;
  icon: StudioIconName;
  hidden: boolean;
  locked: boolean;
};

/** A layer's name is whatever tells them apart at a glance: its own text, or
 *  what kind of thing it is. */
const describe = (o: fabric.FabricObject): { label: string; icon: StudioIconName } => {
  const text = (o as fabric.Textbox).text;
  if (typeof text === 'string' && text.trim()) {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    return {
      label: oneLine.length > 26 ? `${oneLine.slice(0, 26)}…` : oneLine,
      icon: 'text',
    };
  }
  if (o.type === 'image') return { label: 'Image', icon: 'images' };
  if (o.type === 'group') return { label: 'Group', icon: 'icons' };
  return { label: o.type ? o.type[0].toUpperCase() + o.type.slice(1) : 'Shape', icon: 'shapes' };
};

/**
 * Studio had no way to see or reorder what is on the canvas: an object behind
 * another could only be reached by moving the one on top, and z-order could
 * only be changed by deleting and re-adding.
 *
 * Top of the list is the top of the canvas, the way every editor shows it.
 */
export const LayersPanel: FC<{
  canvas: MutableRefObject<fabric.Canvas | null>;
}> = ({ canvas }) => {
  const t = useT();
  const [rows, setRows] = useState<Row[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const read = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const objects = c.getObjects();
    const active = c.getActiveObject();
    const list = objects
      .map((object) => ({
        object,
        ...describe(object),
        hidden: object.visible === false,
        locked: object.selectable === false,
      }))
      .reverse();
    setRows(list);
    setActiveIndex(active ? list.findIndex((r) => r.object === active) : null);
  }, [canvas]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    read();
    const events = [
      'object:added',
      'object:removed',
      'object:modified',
      'selection:created',
      'selection:updated',
      'selection:cleared',
    ] as const;
    events.forEach((e) => c.on(e, read));
    return () => events.forEach((e) => c.off(e, read));
  }, [canvas, read]);

  const withCanvas = (fn: (c: fabric.Canvas) => void) => () => {
    const c = canvas.current;
    if (!c) return;
    fn(c);
    c.requestRenderAll();
    read();
  };

  if (!rows.length) {
    return (
      <div className="flex flex-col gap-2">
        <div className="text-xs uppercase tracking-wide text-textColor/60">
          {t('layers_title', 'Layers')}
        </div>
        <p className="text-[11px] text-textColor/65">
          {t('layers_empty', 'No layers. Add text, shape or image first.')}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 min-h-0">
      <div className="text-xs uppercase tracking-wide text-textColor/60">
        {t('layers_title', 'Layers')}
      </div>
      <div className="flex flex-col gap-1 overflow-y-auto">
        {rows.map((row, index) => (
          <div
            key={index}
            className={clsx(
              'group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors',
              index === activeIndex
                ? 'bg-newAccent/15 border border-newAccent/40'
                : 'border border-transparent hover:bg-white/[0.08]'
            )}
          >
            <button
              onClick={withCanvas((c) => {
                if (row.locked) return;
                c.setActiveObject(row.object);
              })}
              className="flex flex-1 items-center gap-2 min-w-0 text-start"
              title={row.label}
            >
              <StudioIcon name={row.icon} size={14} />
              <span className="truncate text-[11px] text-textColor">{row.label}</span>
            </button>

            <button
              onClick={withCanvas((c) => {
                const index = c.getObjects().indexOf(row.object);
                if (index < c.getObjects().length - 1) c.bringObjectForward(row.object);
              })}
              className="h-6 w-6 rounded flex items-center justify-center text-textColor/65 hover:bg-white/[0.10] hover:text-textColor transition-colors"
              title={t('layer_forward', 'Bring forward')}
              aria-label={t('layer_forward', 'Bring forward')}
            >
              <StudioIcon name="forward" size={14} />
            </button>
            <button
              onClick={withCanvas((c) => c.sendObjectBackwards(row.object))}
              className="h-6 w-6 rounded flex items-center justify-center text-textColor/65 hover:bg-white/[0.10] hover:text-textColor transition-colors"
              title={t('layer_backward', 'Send backward')}
              aria-label={t('layer_backward', 'Send backward')}
            >
              <StudioIcon name="backward" size={14} />
            </button>
            <button
              onClick={withCanvas((c) => {
                row.object.visible = row.hidden;
                if (!row.hidden && c.getActiveObject() === row.object) {
                  c.discardActiveObject();
                }
              })}
              className={clsx(
                'h-6 w-6 rounded flex items-center justify-center transition-colors hover:bg-white/[0.10]',
                row.hidden ? 'text-textColor/40' : 'text-textColor/65 hover:text-textColor'
              )}
              title={row.hidden ? t('layer_show', 'Show') : t('layer_hide', 'Hide')}
              aria-label={row.hidden ? t('layer_show', 'Show') : t('layer_hide', 'Hide')}
            >
              <StudioIcon name={row.hidden ? 'hide' : 'show'} size={14} />
            </button>
            <button
              onClick={withCanvas((c) => {
                const locking = !row.locked;
                row.object.selectable = !locking;
                row.object.evented = !locking;
                if (locking && c.getActiveObject() === row.object) {
                  c.discardActiveObject();
                }
              })}
              className={clsx(
                'h-6 w-6 rounded flex items-center justify-center transition-colors hover:bg-white/[0.10]',
                row.locked ? 'text-newAccent' : 'text-textColor/65 hover:text-textColor'
              )}
              title={row.locked ? t('layer_unlock', 'Unlock') : t('layer_lock', 'Lock')}
              aria-label={row.locked ? t('layer_unlock', 'Unlock') : t('layer_lock', 'Lock')}
            >
              <StudioIcon name={row.locked ? 'lock' : 'unlock'} size={14} />
            </button>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-textColor/65">
        {t('layers_hint', 'Top of the list is the front of the design.')}
      </p>
    </div>
  );
};
