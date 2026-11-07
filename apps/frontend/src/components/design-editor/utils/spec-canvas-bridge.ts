import * as fabric from 'fabric';
import {
  StudioImageLayer,
  StudioLayer,
  StudioPatch,
  StudioShapeLayer,
  StudioSpec,
  StudioTextLayer,
  StudioPlatformKey,
  applyPatch,
  nextStudioId,
} from '@gitroom/nestjs-libraries/studio/studio-spec';
import { PlatformSize } from '../editor.store';

const PLATFORM_KEY_MAP: Record<string, StudioPlatformKey> = {
  'instagram-feed': 'instagram-feed',
  'instagram-square': 'instagram-square',
  'instagram-story': 'instagram-story',
  'facebook-feed': 'facebook',
  'linkedin-feed': 'linkedin',
  'tiktok-cover': 'tiktok',
  'x-post': 'x',
  custom: 'custom',
};

export const toStudioPlatform = (platform: PlatformSize): StudioPlatformKey => {
  return PLATFORM_KEY_MAP[platform.key] ?? 'custom';
};

type FabricOriginX = 'left' | 'center' | 'right';
type FabricOriginY = 'top' | 'center' | 'bottom';

const studioOriginX = (origin: unknown): 'left' | 'center' | 'right' => {
  if (origin === 'center') return 'center';
  if (origin === 'right') return 'right';
  return 'left';
};

const studioOriginY = (origin: unknown): 'top' | 'center' | 'bottom' => {
  if (origin === 'center') return 'center';
  if (origin === 'bottom') return 'bottom';
  return 'top';
};

const fabricOriginX = (origin: StudioLayer['originX']): FabricOriginX => {
  if (origin === 'center') return 'center';
  if (origin === 'right') return 'right';
  return 'left';
};

const fabricOriginY = (origin: StudioLayer['originY']): FabricOriginY => {
  if (origin === 'center') return 'center';
  if (origin === 'bottom') return 'bottom';
  return 'top';
};

const ensureStudioId = (obj: fabric.FabricObject & { studioId?: string }): string => {
  if (!obj.studioId) obj.studioId = nextStudioId();
  return obj.studioId;
};

const textLayer = (obj: fabric.Textbox | fabric.IText): StudioTextLayer => {
  const o = obj as fabric.Textbox & {
    studioId?: string;
    studioSlot?: string;
    studioAiGenerated?: boolean;
    studioTemplateId?: string;
  };
  return {
    id: ensureStudioId(o),
    kind: 'text',
    slot: o.studioSlot,
    aiGenerated: o.studioAiGenerated,
    templateId: o.studioTemplateId,
    x: o.left || 0,
    y: o.top || 0,
    originX: studioOriginX(o.originX),
    originY: studioOriginY(o.originY),
    width: o.width,
    text: o.text || '',
    fontFamily: o.fontFamily || 'Geist, system-ui, sans-serif',
    fontSize: o.fontSize || 16,
    fontWeight: o.fontWeight,
    fontStyle: o.fontStyle === 'italic' ? 'italic' : 'normal',
    textAlign: (o.textAlign as StudioTextLayer['textAlign']) ?? 'left',
    color: (o.fill as string) || '#ffffff',
    lineHeight: o.lineHeight,
    charSpacing: o.charSpacing,
    rotation: o.angle,
    opacity: o.opacity,
  };
};

const shapeKind = (
  obj: fabric.FabricObject
): StudioShapeLayer['kind'] | null => {
  if (obj instanceof fabric.Rect) return 'rect';
  if (obj instanceof fabric.Circle) return 'circle';
  if (obj instanceof fabric.Triangle) return 'triangle';
  if (obj instanceof fabric.Polygon) return 'polygon';
  if (obj instanceof fabric.Line) return 'line';
  if (obj instanceof fabric.Path) return 'path';
  return null;
};

const shapeLayer = (obj: fabric.FabricObject): StudioShapeLayer | null => {
  const kind = shapeKind(obj);
  if (!kind) return null;
  const o = obj as fabric.FabricObject & {
    studioId?: string;
    studioSlot?: string;
    studioAiGenerated?: boolean;
    studioTemplateId?: string;
    rx?: number;
    ry?: number;
    radius?: number;
    path?: string;
  };
  return {
    id: ensureStudioId(o),
    kind,
    slot: o.studioSlot,
    aiGenerated: o.studioAiGenerated,
    templateId: o.studioTemplateId,
    x: o.left || 0,
    y: o.top || 0,
    originX: studioOriginX(o.originX),
    originY: studioOriginY(o.originY),
    width: o.width ? o.width * (o.scaleX || 1) : undefined,
    height: o.height ? o.height * (o.scaleY || 1) : undefined,
    fill: (o.fill as string) || undefined,
    stroke: (o.stroke as string) || undefined,
    strokeWidth: o.strokeWidth,
    rx: o.rx,
    ry: o.ry,
    radius: o.radius,
    path: typeof o.path === 'string' ? o.path : undefined,
    rotation: o.angle,
    opacity: o.opacity,
  };
};

/**
 * What we are willing to tell the model about an image layer.
 *
 * Smart crop leaves its result on the canvas as a data URL (background
 * removal now points at a library file), and the spec is JSON-stringified into the Refine prompt — so a single
 * cut-out could push several megabytes of base64 into the request. That
 * overflows the vision model's context outright, and the text fallback would
 * happily bill for a million tokens of pixels that say nothing about the
 * design. The model only needs to know a picture is there.
 */
const describeImageSrc = (src: string | undefined): string => {
  if (!src) return '';
  return src.startsWith('data:') ? 'data:(edited image)' : src;
};

const imageLayer = (obj: fabric.FabricImage): StudioImageLayer => {
  const o = obj as fabric.FabricImage & {
    studioId?: string;
    studioSlot?: string;
    studioAiGenerated?: boolean;
    studioTemplateId?: string;
  };
  const el = o.getElement() as HTMLImageElement | undefined;
  return {
    id: ensureStudioId(o),
    kind: 'image',
    slot: o.studioSlot,
    aiGenerated: o.studioAiGenerated,
    templateId: o.studioTemplateId,
    x: o.left || 0,
    y: o.top || 0,
    originX: studioOriginX(o.originX),
    originY: studioOriginY(o.originY),
    width: o.width ? o.width * (o.scaleX || 1) : undefined,
    height: o.height ? o.height * (o.scaleY || 1) : undefined,
    src: describeImageSrc(el?.src),
    rotation: o.angle,
    opacity: o.opacity,
  };
};

export const specFromCanvas = (
  canvas: fabric.Canvas,
  platform: PlatformSize,
  brand?: StudioSpec['brand']
): StudioSpec => {
  const layers: StudioLayer[] = [];
  for (const obj of canvas.getObjects()) {
    if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
      layers.push(textLayer(obj));
      continue;
    }
    if (obj instanceof fabric.FabricImage) {
      layers.push(imageLayer(obj));
      continue;
    }
    const shape = shapeLayer(obj);
    if (shape) layers.push(shape);
  }
  return {
    version: 1,
    platform: toStudioPlatform(platform),
    width: platform.width,
    height: platform.height,
    background: (canvas.backgroundColor as string) || '#1a1a2e',
    brand,
    layers,
  };
};

const setStudioFields = (
  obj: fabric.FabricObject,
  layer: StudioLayer
): void => {
  const writable = obj as fabric.FabricObject & {
    studioId?: string;
    studioSlot?: string;
    studioAiGenerated?: boolean;
    studioTemplateId?: string;
  };
  writable.studioId = layer.id;
  writable.studioSlot = layer.slot;
  writable.studioAiGenerated = layer.aiGenerated;
  writable.studioTemplateId = layer.templateId;
};

const buildFabricFromLayer = async (
  layer: StudioLayer
): Promise<fabric.FabricObject | null> => {
  if (layer.kind === 'text') {
    const t = new fabric.Textbox(layer.text, {
      left: layer.x,
      top: layer.y,
      originX: fabricOriginX(layer.originX),
      originY: fabricOriginY(layer.originY),
      width: layer.width ?? 300,
      fontFamily: layer.fontFamily || 'Arial',
      fontSize: layer.fontSize,
      fontWeight: layer.fontWeight,
      fontStyle: layer.fontStyle,
      textAlign: layer.textAlign ?? 'left',
      fill: layer.color,
      lineHeight: layer.lineHeight,
      charSpacing: layer.charSpacing,
      angle: layer.rotation,
      opacity: layer.opacity,
    });
    setStudioFields(t, layer);
    return t;
  }

  if (layer.kind === 'image') {
    const img = await fabric.FabricImage.fromURL(layer.src, {
      crossOrigin: 'anonymous',
    });
    img.set({
      left: layer.x,
      top: layer.y,
      originX: fabricOriginX(layer.originX),
      originY: fabricOriginY(layer.originY),
      angle: layer.rotation,
      opacity: layer.opacity,
    });
    if (layer.width && img.width) {
      img.scaleX = layer.width / img.width;
    }
    if (layer.height && img.height) {
      img.scaleY = layer.height / img.height;
    }
    setStudioFields(img, layer);
    return img;
  }

  const common = {
    left: layer.x,
    top: layer.y,
    originX: fabricOriginX(layer.originX),
    originY: fabricOriginY(layer.originY),
    fill: layer.fill,
    stroke: layer.stroke,
    strokeWidth: layer.strokeWidth,
    angle: layer.rotation,
    opacity: layer.opacity,
  };

  let obj: fabric.FabricObject | null = null;
  if (layer.kind === 'rect') {
    obj = new fabric.Rect({
      ...common,
      width: layer.width ?? 100,
      height: layer.height ?? 100,
      rx: layer.rx,
      ry: layer.ry,
    });
  } else if (layer.kind === 'circle') {
    obj = new fabric.Circle({ ...common, radius: layer.radius ?? 50 });
  } else if (layer.kind === 'triangle') {
    obj = new fabric.Triangle({
      ...common,
      width: layer.width ?? 100,
      height: layer.height ?? 100,
    });
  } else if (layer.kind === 'polygon' && layer.points?.length) {
    obj = new fabric.Polygon(layer.points, common);
  } else if (layer.kind === 'path' && layer.path) {
    obj = new fabric.Path(layer.path, common);
  } else if (layer.kind === 'line') {
    obj = new fabric.Line(
      [
        (layer.x || 0) - (layer.width ?? 100) / 2,
        layer.y || 0,
        (layer.x || 0) + (layer.width ?? 100) / 2,
        layer.y || 0,
      ],
      common
    );
  }
  if (obj) setStudioFields(obj, layer);
  return obj;
};

export const renderSpecToCanvas = async (
  canvas: fabric.Canvas,
  spec: StudioSpec
): Promise<void> => {
  canvas.getObjects().forEach((o) => canvas.remove(o));
  canvas.backgroundColor = spec.background;
  for (const layer of spec.layers) {
    // Build each layer in isolation: a single malformed layer (e.g. a bad
    // font that makes Fabric's text measurement throw) must NOT abort the
    // whole render and crash the editor — skip it and keep going.
    try {
      const obj = await buildFabricFromLayer(layer);
      if (obj) canvas.add(obj);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[Postra:studio] skipped a layer that failed to render:', err);
    }
  }
  canvas.renderAll();
};

const findById = (canvas: fabric.Canvas, id: string): fabric.FabricObject | null => {
  for (const obj of canvas.getObjects()) {
    const o = obj as fabric.FabricObject & { studioId?: string };
    if (o.studioId === id) return obj;
  }
  return null;
};

const applyUpdateToFabric = (
  obj: fabric.FabricObject,
  props: Record<string, unknown>
): void => {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    // Map StudioSpec field names to Fabric properties where they differ.
    if (key === 'x') next.left = value;
    else if (key === 'y') next.top = value;
    else if (key === 'rotation') next.angle = value;
    else if (key === 'color') next.fill = value;
    else if (key === 'text' && (obj instanceof fabric.Textbox || obj instanceof fabric.IText)) {
      (obj as fabric.Textbox).set('text', String(value));
    } else {
      next[key] = value;
    }
  }
  obj.set(next);
};

export const applyPatchToCanvas = async (
  canvas: fabric.Canvas,
  spec: StudioSpec,
  patch: StudioPatch
): Promise<StudioSpec> => {
  for (const op of patch.ops) {
    if (op.op === 'delete') {
      const obj = findById(canvas, op.id);
      if (obj) canvas.remove(obj);
      continue;
    }
    if (op.op === 'update') {
      const obj = findById(canvas, op.id);
      if (obj) applyUpdateToFabric(obj, op.props as Record<string, unknown>);
      continue;
    }
    if (op.op === 'add') {
      const obj = await buildFabricFromLayer(op.layer);
      if (obj) canvas.add(obj);
      continue;
    }
    if (op.op === 'reorder') {
      op.ids.forEach((id, idx) => {
        const obj = findById(canvas, id);
        if (obj) canvas.moveObjectTo(obj, idx);
      });
    }
  }
  canvas.renderAll();
  return applyPatch(spec, patch);
};

/**
 * Capture a low-resolution JPEG of the current canvas for GPT-4 vision input.
 * We deliberately downscale and use JPEG — vision tokens scale with image size,
 * we don't need photo-quality, and PNG ignores `quality` so a photographic
 * background blows the payload up to several MB (→ 413 on the upload). JPEG at
 * 0.8 keeps a 768px screenshot well under a few hundred KB.
 */
export const screenshotForVision = (canvas: fabric.Canvas): string => {
  const scale = Math.min(1, 768 / Math.max(canvas.getWidth(), canvas.getHeight()));
  return canvas.toDataURL({ format: 'jpeg', quality: 0.8, multiplier: scale });
};
