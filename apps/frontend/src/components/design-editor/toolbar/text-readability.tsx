'use client';

import { FC, MutableRefObject, useCallback, useEffect, useState } from 'react';
import * as fabric from 'fabric';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { contrastRatio, isReadable, scrimFor } from '../utils/brand-colors';
import { sampleBehind } from '../utils/sample-behind';

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
  /** Bumped by the inspector whenever the selection or an object changes. */
  version: number;
}

const SCRIM_PADDING = 24;

/**
 * White text on a bright photo is the single easiest way to make a post
 * unreadable, and Studio had nothing to say about it. This measures the real
 * contrast and offers the fix in one click.
 */
export const TextReadability: FC<Props> = ({ canvas, version }) => {
  const t = useT();
  const [state, setState] = useState<{
    background: string;
    textColor: string;
    ratio: number;
  } | null>(null);

  useEffect(() => {
    const c = canvas.current;
    const target = c?.getActiveObject();
    if (!c || !target || !(target instanceof fabric.IText)) {
      setState(null);
      return;
    }
    const textColor = typeof target.fill === 'string' ? target.fill : '';
    if (!textColor.startsWith('#')) {
      setState(null);
      return;
    }
    // Measuring costs a repaint, so do it a beat after the change rather than
    // on every tick of a slider.
    const id = window.setTimeout(() => {
      const background = sampleBehind(c, target);
      if (!background) {
        setState(null);
        return;
      }
      setState({
        background,
        textColor,
        ratio: contrastRatio(textColor, background),
      });
    }, 250);
    return () => window.clearTimeout(id);
  }, [canvas, version]);

  const addScrim = useCallback(() => {
    const c = canvas.current;
    const target = c?.getActiveObject();
    if (!c || !target || !state) return;
    const scrim = scrimFor(state.textColor, state.background);
    if (!scrim) return;
    const rect = target.getBoundingRect();
    const layer = new fabric.Rect({
      left: rect.left - SCRIM_PADDING,
      top: rect.top - SCRIM_PADDING,
      width: rect.width + SCRIM_PADDING * 2,
      height: rect.height + SCRIM_PADDING * 2,
      originX: 'left',
      originY: 'top',
      fill: scrim.color,
      opacity: scrim.opacity,
      selectable: true,
      evented: true,
    });
    c.add(layer);
    // Directly under the text, not at the very bottom: a scrim below the photo
    // would do nothing at all.
    const textIndex = c.getObjects().indexOf(target);
    c.moveObjectTo(layer, Math.max(0, textIndex));
    c.setActiveObject(target);
    c.fire('object:modified', { target: layer } as fabric.ModifiedEvent);
    c.requestRenderAll();
  }, [canvas, state]);

  if (!state || isReadable(state.textColor, state.background)) return null;

  return (
    <div className="flex flex-col gap-1.5 p-2 rounded bg-yellow-500/10 border border-yellow-500/30">
      <span className="flex items-start gap-1.5 text-[12px] text-yellow-200/90 leading-snug">
        <StudioIcon name="warning" size={14} className="mt-[2px] shrink-0" />
        {t(
          'contrast_warning',
          'This text is hard to read on what is behind it'
        )}{' '}
        <span className="tabular-nums opacity-80">({state.ratio}:1)</span>
      </span>
      <button
        onClick={addScrim}
        className="text-xs px-3 py-1.5 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
      >
        {t('contrast_add_scrim', 'Add a shade behind it')}
      </button>
    </div>
  );
};
