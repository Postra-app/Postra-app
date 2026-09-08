'use client';

import {
  FC,
  MutableRefObject,
  useCallback,
  useEffect,
  useState,
} from 'react';
import * as fabric from 'fabric';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useEditorStore } from '../editor.store';
import clsx from 'clsx';

interface Props {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

type PresetKey = 'original' | 'bw' | 'sepia' | 'vivid' | 'cool' | 'warm';

interface FilterState {
  brightness: number;
  contrast: number;
  saturation: number;
  blur: number;
  preset: PresetKey;
}

const ZERO_STATE: FilterState = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
  preset: 'original',
};

const COOL_TINT = '#3b82f6';
const WARM_TINT = '#f59e0b';
const VIVID_VIBRANCE = 0.6;
const VIVID_SATURATION = 0.2;

const SELECTION_EVENTS = [
  'selection:created',
  'selection:updated',
  'selection:cleared',
  'object:modified',
] as const;

/** Rebuild a Fabric filters array from slider + preset state. */
const buildFilters = (s: FilterState): fabric.FabricImage['filters'] => {
  const next: fabric.FabricImage['filters'] = [];
  if (s.brightness !== 0)
    next.push(new fabric.filters.Brightness({ brightness: s.brightness }));
  if (s.contrast !== 0)
    next.push(new fabric.filters.Contrast({ contrast: s.contrast }));
  if (s.saturation !== 0)
    next.push(new fabric.filters.Saturation({ saturation: s.saturation }));
  if (s.blur !== 0) next.push(new fabric.filters.Blur({ blur: s.blur }));
  switch (s.preset) {
    case 'bw':
      next.push(new fabric.filters.Grayscale());
      break;
    case 'sepia':
      next.push(new fabric.filters.Sepia());
      break;
    case 'vivid':
      next.push(new fabric.filters.Vibrance({ vibrance: VIVID_VIBRANCE }));
      break;
    case 'cool':
      next.push(
        new fabric.filters.BlendColor({
          color: COOL_TINT,
          mode: 'tint',
          alpha: 0.12,
        })
      );
      break;
    case 'warm':
      next.push(
        new fabric.filters.BlendColor({
          color: WARM_TINT,
          mode: 'tint',
          alpha: 0.12,
        })
      );
      break;
  }
  return next;
};

/** Read existing filters off an image so reopening the panel shows them. */
const readFilters = (img: fabric.FabricImage): FilterState => {
  const s: FilterState = { ...ZERO_STATE };
  for (const f of img.filters ?? []) {
    if (f instanceof fabric.filters.Brightness) s.brightness = f.brightness;
    else if (f instanceof fabric.filters.Contrast) s.contrast = f.contrast;
    else if (f instanceof fabric.filters.Saturation) s.saturation = f.saturation;
    else if (f instanceof fabric.filters.Blur) s.blur = f.blur;
    else if (f instanceof fabric.filters.Grayscale) s.preset = 'bw';
    else if (f instanceof fabric.filters.Sepia) s.preset = 'sepia';
    else if (f instanceof fabric.filters.Vibrance) s.preset = 'vivid';
    else if (f instanceof fabric.filters.BlendColor)
      s.preset = f.color === WARM_TINT ? 'warm' : 'cool';
  }
  return s;
};

const SLIDERS: {
  key: keyof Omit<FilterState, 'preset'>;
  labelKey: string;
  fallback: string;
  min: number;
  max: number;
  step: number;
}[] = [
  { key: 'brightness', labelKey: 'filter_brightness', fallback: 'Brightness', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'contrast', labelKey: 'filter_contrast', fallback: 'Contrast', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'saturation', labelKey: 'filter_saturation', fallback: 'Saturation', min: -1, max: 1, step: 0.02 },
  { key: 'blur', labelKey: 'filter_blur', fallback: 'Blur', min: 0, max: 0.5, step: 0.01 },
];

const PRESETS: { key: PresetKey; labelKey: string; fallback: string }[] = [
  { key: 'original', labelKey: 'filter_preset_original', fallback: 'Original' },
  { key: 'bw', labelKey: 'filter_preset_bw', fallback: 'B&W' },
  { key: 'sepia', labelKey: 'filter_preset_sepia', fallback: 'Sepia' },
  { key: 'vivid', labelKey: 'filter_preset_vivid', fallback: 'Vivid' },
  { key: 'cool', labelKey: 'filter_preset_cool', fallback: 'Cool' },
  { key: 'warm', labelKey: 'filter_preset_warm', fallback: 'Warm' },
];

// Lightroom-lite: built-in Fabric WebGL filters on the selected image.
// Filters serialize inside the image object JSON, so undo/redo, carousel
// slides and saved designs all keep them for free.
export const ImageFiltersPanel: FC<Props> = ({ canvas }) => {
  const t = useT();
  const [state, setState] = useState<FilterState>(ZERO_STATE);
  // Bumped on selection / external modification so we re-read the canvas.
  const [version, setVersion] = useState(0);

  // Mounted before the canvas exists whenever Images is the remembered tool,
  // and the ref never triggers a re-run — so the panel subscribed to nothing
  // and sat on "Select an image" no matter what was selected. canvasReady is
  // the signal that the ref has been filled in (same fix as the inspector).
  const canvasReady = useEditorStore((s) => s.canvasReady);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const bump = () => setVersion((n) => n + 1);
    SELECTION_EVENTS.forEach((e) => c.on(e, bump));
    return () => {
      SELECTION_EVENTS.forEach((e) => c.off(e, bump));
    };
  }, [canvas, canvasReady]);

  const getActiveImage = useCallback((): fabric.FabricImage | null => {
    const active = canvas.current?.getActiveObject();
    return active instanceof fabric.FabricImage ? active : null;
  }, [canvas]);

  // Sync local state FROM the selected image when the selection changes,
  // so reopening the panel shows the image's current filter values.
  useEffect(() => {
    const img = getActiveImage();
    setState(img ? readFilters(img) : ZERO_STATE);
  }, [version, getActiveImage]);

  const apply = useCallback(
    (next: FilterState) => {
      setState(next);
      const img = getActiveImage();
      if (!img || !canvas.current) return;
      img.filters = buildFilters(next);
      img.applyFilters();
      canvas.current.requestRenderAll();
    },
    [canvas, getActiveImage]
  );

  // Land the change in undo history the same way drag/resize edits do:
  // post-design-editor listens for object:modified and snapshots toJSON().
  const commit = useCallback(() => {
    const img = getActiveImage();
    if (!img || !canvas.current) return;
    canvas.current.fire('object:modified', {
      target: img,
    } as fabric.ModifiedEvent);
  }, [canvas, getActiveImage]);

  const applyPreset = useCallback(
    (preset: PresetKey) => {
      const next: FilterState =
        preset === 'original'
          ? { ...ZERO_STATE }
          : {
              ...state,
              preset,
              // Vivid = Vibrance 0.6 + Saturation 0.2 (via the slider).
              ...(preset === 'vivid' ? { saturation: VIVID_SATURATION } : {}),
            };
      apply(next);
      commit();
    },
    [state, apply, commit]
  );

  const hasImage = !!getActiveImage();

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] text-textColor/60 uppercase tracking-wide">
        {t('filter_section', 'Filters')}
      </span>

      {!hasImage ? (
        <p className="text-[10px] text-textColor/40 leading-snug">
          {t('crop_no_image', 'Select an image on the canvas')}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.key)}
                className={clsx(
                  'text-[10px] px-1.5 py-1.5 rounded transition-colors',
                  state.preset === p.key
                    ? 'bg-forth text-white'
                    : 'bg-newColColor hover:bg-white/[0.08] text-textColor'
                )}
              >
                {t(p.labelKey, p.fallback)}
              </button>
            ))}
          </div>

          {SLIDERS.map((s) => (
            <label key={s.key} className="flex flex-col gap-0.5">
              <span className="flex justify-between text-[10px] text-textColor/60">
                <span>{t(s.labelKey, s.fallback)}</span>
                <span className="tabular-nums">{state[s.key].toFixed(2)}</span>
              </span>
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={state[s.key]}
                onChange={(e) =>
                  apply({ ...state, [s.key]: parseFloat(e.target.value) })
                }
                onPointerUp={commit}
                onKeyUp={commit}
                className="w-full h-1.5 accent-forth cursor-pointer"
                aria-label={t(s.labelKey, s.fallback)}
              />
            </label>
          ))}

          <button
            onClick={() => applyPreset('original')}
            className="text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
          >
            {t('filter_reset', 'Reset filters')}
          </button>
        </>
      )}
    </div>
  );
};
