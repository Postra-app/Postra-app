/**
 * StudioSpec — semantic canvas representation for AI roundtrip.
 *
 * AI Refine (`StudioAiService.refineSpec`) exchanges this shape with the
 * backend, and `POST /media/:id/design-spec` stores it on a media row. Fabric
 * `toJSON()` is too verbose +
 * triggers hallucinated property names; this shape stays close to the
 * "agent-template" pattern (tldraw) — small, typed, addressable by stable id.
 *
 * Layer ids must be stable across roundtrips so AI patches can target them.
 */

export type StudioPlatformKey =
  | 'instagram-feed'
  | 'instagram-square'
  | 'instagram-story'
  | 'facebook'
  | 'linkedin'
  | 'tiktok'
  | 'x'
  | 'custom';

export interface StudioBrandRef {
  primary: string;
  secondary: string;
  text: string;
  fontFamily?: string;
  tone?: string;
}

export type StudioLayerKind =
  | 'text'
  | 'image'
  | 'rect'
  | 'circle'
  | 'triangle'
  | 'polygon'
  | 'path'
  | 'line';

export type StudioOrigin = 'left' | 'center' | 'right' | 'top' | 'bottom';

export interface StudioLayerBase {
  id: string;
  kind: StudioLayerKind;
  slot?: string;
  aiGenerated?: boolean;
  templateId?: string;
  x: number;
  y: number;
  originX: StudioOrigin;
  originY: StudioOrigin;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
}

export interface StudioTextLayer extends StudioLayerBase {
  kind: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string | number;
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  color: string;
  lineHeight?: number;
  charSpacing?: number;
}

export interface StudioImageLayer extends StudioLayerBase {
  kind: 'image';
  src: string;
  scaleX?: number;
  scaleY?: number;
}

export interface StudioShapeLayer extends StudioLayerBase {
  kind: 'rect' | 'circle' | 'triangle' | 'polygon' | 'path' | 'line';
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  rx?: number;
  ry?: number;
  radius?: number;
  points?: { x: number; y: number }[];
  path?: string;
}

export type StudioLayer = StudioTextLayer | StudioImageLayer | StudioShapeLayer;

export interface StudioSpec {
  version: 1;
  platform: StudioPlatformKey;
  width: number;
  height: number;
  background: string;
  brand?: StudioBrandRef;
  layers: StudioLayer[];
}

export type StudioPatchOp =
  | { op: 'add'; layer: StudioLayer }
  | { op: 'update'; id: string; props: Partial<StudioLayer> }
  | { op: 'delete'; id: string }
  | { op: 'reorder'; ids: string[] };

export interface StudioPatch {
  base: number;
  ops: StudioPatchOp[];
}

/**
 * Custom keys on Fabric objects we serialize via `toObject(includeKeys)`.
 * Keep this list small — every entry inflates JSON sent to AI.
 */
export const STUDIO_FABRIC_METADATA_KEYS = [
  'studioId',
  'studioSlot',
  'studioAiGenerated',
  'studioTemplateId',
] as const;

export type StudioFabricMetadataKey = (typeof STUDIO_FABRIC_METADATA_KEYS)[number];

export interface StudioFabricMetadata {
  studioId?: string;
  studioSlot?: string;
  studioAiGenerated?: boolean;
  studioTemplateId?: string;
}

let idCounter = 0;
export const nextStudioId = (prefix = 'lyr'): string => {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${prefix}_${Date.now().toString(36)}_${idCounter}_${rand}`;
};

/**
 * Server-side patch validator. Reject patches that reference unknown ids,
 * duplicate adds, or grow the canvas beyond hard limits. Must run before
 * applying any AI-emitted patch.
 */
export const validatePatchAgainstSpec = (
  spec: StudioSpec,
  patch: StudioPatch
): { ok: true } | { ok: false; reason: string } => {
  const ids = new Set(spec.layers.map((l) => l.id));
  for (const op of patch.ops) {
    if (op.op === 'add') {
      if (ids.has(op.layer.id)) {
        return { ok: false, reason: `duplicate add id ${op.layer.id}` };
      }
      ids.add(op.layer.id);
    } else if (op.op === 'update' || op.op === 'delete') {
      if (!ids.has(op.id)) {
        return { ok: false, reason: `unknown layer id ${op.id}` };
      }
      if (op.op === 'delete') ids.delete(op.id);
    } else if (op.op === 'reorder') {
      for (const id of op.ids) {
        if (!ids.has(id)) {
          return { ok: false, reason: `reorder references unknown id ${id}` };
        }
      }
      if (op.ids.length !== ids.size) {
        return { ok: false, reason: 'reorder must list every layer exactly once' };
      }
    }
  }
  if (ids.size > 200) return { ok: false, reason: 'layer cap (200) exceeded' };
  return { ok: true };
};

export const applyPatch = (spec: StudioSpec, patch: StudioPatch): StudioSpec => {
  const layers = spec.layers.slice();
  const indexOf = (id: string) => layers.findIndex((l) => l.id === id);
  for (const op of patch.ops) {
    if (op.op === 'add') {
      layers.push(op.layer);
    } else if (op.op === 'update') {
      const i = indexOf(op.id);
      if (i >= 0) layers[i] = { ...layers[i], ...op.props } as StudioLayer;
    } else if (op.op === 'delete') {
      const i = indexOf(op.id);
      if (i >= 0) layers.splice(i, 1);
    } else if (op.op === 'reorder') {
      layers.sort((a, b) => op.ids.indexOf(a.id) - op.ids.indexOf(b.id));
    }
  }
  return { ...spec, layers };
};
