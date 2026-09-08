'use client';

import {
  FC,
  Fragment,
  MutableRefObject,
  ReactNode,
  useCallback,
  useEffect,
  useState,
} from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '../editor.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import clsx from 'clsx';

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

const SELECTION_EVENTS = [
  'selection:created',
  'selection:updated',
  'selection:cleared',
  'object:modified',
] as const;

const FONT_SIZE_MIN = 8;
const FONT_SIZE_MAX = 300;
const STROKE_WIDTH_MAX = 40;
const DEFAULT_STROKE = '#ffffff';

const isText = (o: fabric.FabricObject): o is fabric.IText =>
  o instanceof fabric.IText;

// Stroke controls only make sense on primitive shapes — images have no
// outline concept here and SVG icons come in as Groups whose children own
// the stroke.
const isShape = (o: fabric.FabricObject) =>
  !(o instanceof fabric.FabricImage) &&
  !(o instanceof fabric.Group) &&
  !isText(o);

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

const ALIGNMENTS: {
  key: 'left' | 'center' | 'right';
  labelKey: string;
  fallback: string;
}[] = [
  { key: 'left', labelKey: 'props_align_left', fallback: 'Align left' },
  { key: 'center', labelKey: 'props_align_center', fallback: 'Center' },
  { key: 'right', labelKey: 'props_align_right', fallback: 'Align right' },
];

// Unicode alignment glyphs render as tofu in some fonts — draw the three
// bars ourselves.
const AlignIcon: FC<{ align: 'left' | 'center' | 'right' }> = ({ align }) => (
  <span
    className={clsx(
      'flex flex-col gap-[3px] w-4 mx-auto',
      align === 'left' && 'items-start',
      align === 'center' && 'items-center',
      align === 'right' && 'items-end'
    )}
  >
    <span className="h-[2px] w-full bg-current rounded" />
    <span className="h-[2px] w-2.5 bg-current rounded" />
    <span className="h-[2px] w-full bg-current rounded" />
  </span>
);

// Context panel for the selected object(s): font size / bold / italic /
// alignment for text, outline for shapes, opacity + precise rotation for
// everything. Colour lives in the swatch section above (added in #153).
export const PropertyInspector: FC<Props> = ({ canvas }) => {
  const t = useT();
  const { canvasReady } = useEditorStore();
  // Bumped on selection / external modification so we re-read the canvas.
  const [, setVersion] = useState(0);

  // The panel is mounted before the canvas exists (Select is the default
  // tool), so re-subscribe once canvasReady flips.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const bump = () => setVersion((n) => n + 1);
    SELECTION_EVENTS.forEach((e) => c.on(e, bump));
    return () => {
      SELECTION_EVENTS.forEach((e) => c.off(e, bump));
    };
  }, [canvas, canvasReady]);

  const objects = canvas.current?.getActiveObjects() ?? [];
  const activeObject = canvas.current?.getActiveObject() ?? null;
  const texts = objects.filter(isText);
  const shapes = objects.filter(isShape);

  // Land changes in undo history the same way drag/resize edits do:
  // post-design-editor listens for object:modified and snapshots toJSON().
  const commit = useCallback(() => {
    const c = canvas.current;
    const target = c?.getActiveObject();
    if (!c || !target) return;
    c.fire('object:modified', { target } as fabric.ModifiedEvent);
  }, [canvas]);

  const applyToTexts = useCallback(
    (props: Partial<fabric.IText>) => {
      const c = canvas.current;
      if (!c) return;
      c.getActiveObjects().filter(isText).forEach((o) => {
        o.set(props);
        o.setCoords();
      });
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  const applyToShapes = useCallback(
    (props: Partial<fabric.FabricObject>) => {
      const c = canvas.current;
      if (!c) return;
      c.getActiveObjects().filter(isShape).forEach((o) => {
        o.set(props);
        o.setCoords();
      });
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  const applyOpacity = useCallback(
    (opacity: number) => {
      const c = canvas.current;
      if (!c) return;
      // Per underlying object — opacity set on an ActiveSelection wrapper
      // would be dropped when the selection is dismissed.
      c.getActiveObjects().forEach((o) => o.set({ opacity }));
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  const applyRotation = useCallback(
    (angle: number) => {
      const c = canvas.current;
      const target = c?.getActiveObject();
      if (!c || !target) return;
      // Rotate the top-level active object: for a multi-select that spins
      // the whole selection and Fabric bakes the transform into children.
      target.rotate(normalizeAngle(angle));
      target.setCoords();
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  const setStrokeWidth = useCallback(
    (width: number) => {
      const c = canvas.current;
      if (!c) return;
      c.getActiveObjects().filter(isShape).forEach((o) => {
        // A width without a colour renders nothing — give it one.
        o.set({
          strokeWidth: width,
          ...(width > 0 && !o.stroke ? { stroke: DEFAULT_STROKE } : {}),
          strokeUniform: true,
        });
        o.setCoords();
      });
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  if (!activeObject || !objects.length) return null;

  const text = texts[0];
  const fontSize = text ? Math.round(text.fontSize ?? 48) : 0;
  const fontWeight = text?.fontWeight;
  const isBold =
    fontWeight === 'bold' || (typeof fontWeight === 'number' && fontWeight >= 600);
  const isItalic = text?.fontStyle === 'italic';
  const textAlign = text?.textAlign ?? 'left';

  const shape = shapes[0];
  const strokeWidth = shape ? Math.round(shape.strokeWidth ?? 0) : 0;
  const strokeColor =
    shape && typeof shape.stroke === 'string' && shape.stroke !== 'transparent'
      ? shape.stroke
      : DEFAULT_STROKE;

  const opacity = objects[0].opacity ?? 1;
  const angle = Math.round(normalizeAngle(activeObject.angle ?? 0));

  const toggleButton = (
    active: boolean,
    onClick: () => void,
    label: string,
    content: ReactNode
  ) => (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={clsx(
        'flex-1 px-2 py-1.5 rounded text-xs transition-colors',
        active
          ? 'bg-forth text-white'
          : 'bg-newColColor hover:bg-white/[0.08] text-textColor'
      )}
    >
      {content}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 border-t border-newBorder pt-3">
      <span className="text-[10px] text-textColor/60 uppercase tracking-wide">
        {t('props_section', 'Selected object')}
      </span>

      {text && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[10px] text-textColor/60">
              <span>{t('props_font_size', 'Font size')}</span>
              <span className="tabular-nums">{fontSize}px</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={1}
                value={fontSize}
                onChange={(e) =>
                  applyToTexts({ fontSize: parseInt(e.target.value, 10) })
                }
                onPointerUp={commit}
                onKeyUp={commit}
                className="flex-1 h-1.5 accent-forth cursor-pointer"
                aria-label={t('props_font_size', 'Font size')}
              />
              <input
                type="number"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                value={fontSize}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v))
                    applyToTexts({
                      fontSize: Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, v)),
                    });
                }}
                onBlur={commit}
                className="w-14 text-xs px-1.5 py-1 rounded bg-newColColor text-textColor border border-newBorder focus:outline-none focus:border-forth tabular-nums"
                aria-label={t('props_font_size', 'Font size')}
              />
            </div>
          </label>

          <div className="flex gap-1.5">
            {toggleButton(
              isBold,
              () => {
                applyToTexts({ fontWeight: isBold ? 'normal' : 'bold' });
                commit();
              },
              t('props_bold', 'Bold'),
              <span className="font-bold">B</span>
            )}
            {toggleButton(
              isItalic,
              () => {
                applyToTexts({ fontStyle: isItalic ? 'normal' : 'italic' });
                commit();
              },
              t('props_italic', 'Italic'),
              <span className="italic">I</span>
            )}
            {ALIGNMENTS.map((a) => (
              <Fragment key={a.key}>
                {toggleButton(
                  textAlign === a.key,
                  () => {
                    applyToTexts({ textAlign: a.key });
                    commit();
                  },
                  t(a.labelKey, a.fallback),
                  <AlignIcon align={a.key} />
                )}
              </Fragment>
            ))}
          </div>
        </>
      )}

      {shape && (
        <label className="flex flex-col gap-0.5">
          <span className="flex justify-between text-[10px] text-textColor/60">
            <span>{t('props_stroke_width', 'Outline width')}</span>
            <span className="tabular-nums">{strokeWidth}px</span>
          </span>
          <div className="flex items-center gap-1.5">
            <input
              type="range"
              min={0}
              max={STROKE_WIDTH_MAX}
              step={1}
              value={strokeWidth}
              onChange={(e) => setStrokeWidth(parseInt(e.target.value, 10))}
              onPointerUp={commit}
              onKeyUp={commit}
              className="flex-1 h-1.5 accent-forth cursor-pointer"
              aria-label={t('props_stroke_width', 'Outline width')}
            />
            <input
              type="color"
              value={strokeColor}
              onChange={(e) => applyToShapes({ stroke: e.target.value })}
              onBlur={commit}
              className="w-8 h-7 rounded cursor-pointer border-0 bg-transparent"
              aria-label={t('props_stroke_color', 'Outline colour')}
            />
          </div>
        </label>
      )}

      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between text-[10px] text-textColor/60">
          <span>{t('props_opacity', 'Opacity')}</span>
          <span className="tabular-nums">{Math.round(opacity * 100)}%</span>
        </span>
        <input
          type="range"
          min={0.05}
          max={1}
          step={0.01}
          value={opacity}
          onChange={(e) => applyOpacity(parseFloat(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          className="w-full h-1.5 accent-forth cursor-pointer"
          aria-label={t('props_opacity', 'Opacity')}
        />
      </label>

      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between text-[10px] text-textColor/60">
          <span>{t('props_rotation', 'Rotation')}</span>
          <span className="tabular-nums">{angle}°</span>
        </span>
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            min={0}
            max={359}
            step={1}
            value={angle}
            onChange={(e) => applyRotation(parseInt(e.target.value, 10))}
            onPointerUp={commit}
            onKeyUp={commit}
            className="flex-1 h-1.5 accent-forth cursor-pointer"
            aria-label={t('props_rotation', 'Rotation')}
          />
          <input
            type="number"
            min={0}
            max={359}
            value={angle}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (!Number.isNaN(v)) applyRotation(v);
            }}
            onBlur={commit}
            className="w-14 text-xs px-1.5 py-1 rounded bg-newColColor text-textColor border border-newBorder focus:outline-none focus:border-forth tabular-nums"
            aria-label={t('props_rotation', 'Rotation')}
          />
        </div>
      </label>
    </div>
  );
};
