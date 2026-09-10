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
import { TextReadability } from './text-readability';
import {
  readBox,
  scaleForSize,
  clampSize,
  clampCornerRadius,
  cornerRadiusOf,
} from '../utils/object-geometry';
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
const LINE_HEIGHT_MIN = 0.8;
const LINE_HEIGHT_MAX = 2.5;
// Fabric measures letter spacing in 1/1000 em, so 100 is a tenth of the font
// size — the range below is roughly "tight" to "poster wide".
const LETTER_SPACING_MIN = -100;
const LETTER_SPACING_MAX = 600;
const TEXT_OUTLINE_MAX = 20;
const TEXT_SHADOW = { color: 'rgba(0,0,0,0.45)', blur: 12, offsetX: 0, offsetY: 4 };
const HIGHLIGHT_DEFAULT = '#0a0e1a';
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
  const [version, setVersion] = useState(0);

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

  const applyToActive = useCallback(
    (props: Partial<fabric.FabricObject>) => {
      const c = canvas.current;
      const target = c?.getActiveObject();
      if (!c || !target) return;
      target.set(props);
      target.setCoords();
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  /** Move by the top-left corner, whatever origin the object was built with. */
  const applyPosition = useCallback(
    (left: number, top: number) => {
      const c = canvas.current;
      const target = c?.getActiveObject();
      if (!c || !target) return;
      target.setXY(new fabric.Point(left, top), 'left', 'top');
      target.setCoords();
      c.requestRenderAll();
      setVersion((n) => n + 1);
    },
    [canvas]
  );

  /** Width and height are a scale in Fabric, except on a Textbox, which owns
   *  its width and derives its height from the text inside it. */
  const applySize = useCallback(
    (width: number, height: number) => {
      const c = canvas.current;
      const target = c?.getActiveObject();
      if (!c || !target) return;
      if (target instanceof fabric.Textbox) {
        target.set({ width: clampSize(width), scaleX: 1, scaleY: 1 });
        target.initDimensions();
      } else {
        target.set(scaleForSize(target, width, height));
      }
      target.setCoords();
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

  const lineHeight = text?.lineHeight ?? 1.16;
  const letterSpacing = Math.round(text?.charSpacing ?? 0);
  const textOutlineWidth = text ? Math.round(text.strokeWidth ?? 0) : 0;
  const textOutlineColor =
    text && typeof text.stroke === 'string' && text.stroke !== 'transparent'
      ? text.stroke
      : '#000000';
  const hasShadow = Boolean(text?.shadow);
  const highlight =
    typeof text?.textBackgroundColor === 'string' && text.textBackgroundColor
      ? text.textBackgroundColor
      : '';

  // Read the drawn box, not the raw left/top: Fabric v7 objects are
  // centre-origin, so `left` is the middle of the object and showing it as "X"
  // put the number a third of a canvas away from the edge the user sees.
  const bounds = activeObject.getBoundingRect();
  const box = {
    ...readBox(activeObject),
    left: Math.round(bounds.left),
    top: Math.round(bounds.top),
  };
  const isRect = activeObject instanceof fabric.Rect;
  const cornerRadius = cornerRadiusOf(activeObject);

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
          ? 'bg-newAccent text-[#06222e] font-[600]'
          : 'bg-newColColor hover:bg-white/[0.08] text-textColor'
      )}
    >
      {content}
    </button>
  );

  return (
    <div className="flex flex-col gap-2 border-t border-newBorder pt-3">
      <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
        {t('props_section', 'Selected object')}
      </span>

      {text && <TextReadability canvas={canvas} version={version} />}

      {text && (
        <>
          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-textColor/60">
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

          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-textColor/60">
              <span>{t('props_line_height', 'Line spacing')}</span>
              <span className="tabular-nums">{lineHeight.toFixed(2)}</span>
            </span>
            <input
              type="range"
              min={LINE_HEIGHT_MIN}
              max={LINE_HEIGHT_MAX}
              step={0.05}
              value={lineHeight}
              onChange={(e) =>
                applyToTexts({ lineHeight: parseFloat(e.target.value) })
              }
              onPointerUp={commit}
              onKeyUp={commit}
              className="w-full h-1.5 accent-forth cursor-pointer"
              aria-label={t('props_line_height', 'Line spacing')}
            />
          </label>

          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-textColor/60">
              <span>{t('props_letter_spacing', 'Letter spacing')}</span>
              <span className="tabular-nums">{letterSpacing}</span>
            </span>
            <input
              type="range"
              min={LETTER_SPACING_MIN}
              max={LETTER_SPACING_MAX}
              step={5}
              value={letterSpacing}
              onChange={(e) =>
                applyToTexts({ charSpacing: parseInt(e.target.value, 10) })
              }
              onPointerUp={commit}
              onKeyUp={commit}
              className="w-full h-1.5 accent-forth cursor-pointer"
              aria-label={t('props_letter_spacing', 'Letter spacing')}
            />
          </label>

          {/* An outline and a shadow are what make text readable on a photo,
              and both were unreachable from the UI until now. */}
          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-textColor/60">
              <span>{t('props_text_outline', 'Text outline')}</span>
              <span className="tabular-nums">{textOutlineWidth}px</span>
            </span>
            <div className="flex items-center gap-1.5">
              <input
                type="range"
                min={0}
                max={TEXT_OUTLINE_MAX}
                step={1}
                value={textOutlineWidth}
                onChange={(e) => {
                  const width = parseInt(e.target.value, 10);
                  applyToTexts({
                    strokeWidth: width,
                    ...(width > 0 && !text?.stroke ? { stroke: '#000000' } : {}),
                    // Outline under the fill, so thick outlines do not eat
                    // into the letterforms.
                    paintFirst: 'stroke',
                    strokeUniform: true,
                  });
                }}
                onPointerUp={commit}
                onKeyUp={commit}
                className="flex-1 h-1.5 accent-forth cursor-pointer"
                aria-label={t('props_text_outline', 'Text outline')}
              />
              <input
                type="color"
                value={textOutlineColor}
                onChange={(e) => applyToTexts({ stroke: e.target.value })}
                onBlur={commit}
                className="w-8 h-7 rounded cursor-pointer border-0 bg-transparent"
                aria-label={t('props_text_outline_color', 'Outline colour')}
              />
            </div>
          </label>

          <div className="flex gap-1.5">
            {toggleButton(
              hasShadow,
              () => {
                applyToTexts({
                  shadow: hasShadow ? null : new fabric.Shadow(TEXT_SHADOW),
                });
                commit();
              },
              t('props_text_shadow', 'Shadow'),
              <span className="text-[11px]">
                {t('props_text_shadow', 'Shadow')}
              </span>
            )}
            {toggleButton(
              Boolean(highlight),
              () => {
                applyToTexts({
                  textBackgroundColor: highlight ? '' : HIGHLIGHT_DEFAULT,
                });
                commit();
              },
              t('props_text_highlight', 'Highlight'),
              <span className="text-[11px]">
                {t('props_text_highlight', 'Highlight')}
              </span>
            )}
            {highlight && (
              <input
                type="color"
                value={highlight}
                onChange={(e) =>
                  applyToTexts({ textBackgroundColor: e.target.value })
                }
                onBlur={commit}
                className="w-8 h-7 rounded cursor-pointer border-0 bg-transparent"
                aria-label={t('props_text_highlight_color', 'Highlight colour')}
              />
            )}
          </div>
        </>
      )}

      {shape && (
        <label className="flex flex-col gap-0.5">
          <span className="flex justify-between text-[11px] text-textColor/60">
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
        <span className="flex justify-between text-[11px] text-textColor/60">
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

      {/* Position and size were nowhere in the UI: everything had to be dragged
          by hand, and two objects could not be lined up by typing the same
          number twice. */}
      <div className="flex flex-col gap-1.5 border-t border-newBorder pt-2">
        <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
          {t('props_position_section', 'Position & size')}
        </span>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            {
              key: 'x',
              label: t('props_pos_x', 'X'),
              value: box.left,
              onChange: (v: number) => applyPosition(v, box.top),
            },
            {
              key: 'y',
              label: t('props_pos_y', 'Y'),
              value: box.top,
              onChange: (v: number) => applyPosition(box.left, v),
            },
            {
              key: 'w',
              label: t('props_pos_w', 'W'),
              value: box.width,
              onChange: (v: number) => applySize(v, box.height),
            },
            {
              key: 'h',
              label: t('props_pos_h', 'H'),
              value: box.height,
              onChange: (v: number) => applySize(box.width, v),
            },
          ].map((field) => (
            <label key={field.key} className="flex items-center gap-1.5">
              <span className="w-4 text-[11px] text-textColor/60">
                {field.label}
              </span>
              <input
                type="number"
                value={field.value}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!Number.isNaN(v)) field.onChange(v);
                }}
                onBlur={commit}
                className="w-full text-xs px-1.5 py-1 rounded bg-newColColor text-textColor border border-newBorder focus:outline-none focus:border-forth tabular-nums"
                aria-label={field.label}
              />
            </label>
          ))}
        </div>

        <div className="flex gap-1.5">
          {toggleButton(
            Boolean(activeObject.flipX),
            () => {
              applyToActive({ flipX: !activeObject.flipX });
              commit();
            },
            t('props_flip_h', 'Flip horizontally'),
            <span className="text-[11px]">{t('props_flip_h_short', 'Flip H')}</span>
          )}
          {toggleButton(
            Boolean(activeObject.flipY),
            () => {
              applyToActive({ flipY: !activeObject.flipY });
              commit();
            },
            t('props_flip_v', 'Flip vertically'),
            <span className="text-[11px]">{t('props_flip_v_short', 'Flip V')}</span>
          )}
        </div>

        {isRect && (
          <label className="flex flex-col gap-0.5">
            <span className="flex justify-between text-[11px] text-textColor/60">
              <span>{t('props_corner_radius', 'Corner radius')}</span>
              <span className="tabular-nums">{cornerRadius}px</span>
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(1, Math.floor(Math.min(box.width, box.height) / 2))}
              step={1}
              value={cornerRadius}
              onChange={(e) => {
                const radius = clampCornerRadius(parseInt(e.target.value, 10), box);
                applyToActive({ rx: radius, ry: radius } as Partial<fabric.FabricObject>);
              }}
              onPointerUp={commit}
              onKeyUp={commit}
              className="w-full h-1.5 accent-forth cursor-pointer"
              aria-label={t('props_corner_radius', 'Corner radius')}
            />
          </label>
        )}
      </div>

      <label className="flex flex-col gap-0.5">
        <span className="flex justify-between text-[11px] text-textColor/60">
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
