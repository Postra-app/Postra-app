'use client';

import { FC, MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { useEditorStore, EditorTool } from '../editor.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { AiGeneratePanel } from './ai-generate-panel';
import { AiRefinePanel } from './ai-refine-panel';
import { BrandKitPanel } from './brand-kit-panel';
import { IconsPanel } from './icons-panel';
import { LayersPanel } from './layers-panel';
import { TemplatesPanel } from './templates-panel';
import { StockImagesPanel } from './stock-images-panel';
import { ImageFiltersPanel } from './image-filters-panel';
import { STUDIO_FONTS, DEFAULT_FONT, findFontByFamily } from '../fonts';
import { ensureFontsLoaded } from '../utils/font-loading';
import { blend } from '../utils/brand-colors';
import {
  cropFromRect,
  resetCrop,
  initialCropRect,
  CroppableImage,
} from '../utils/image-crop';
import {
  removeBackgroundFromImage,
  replaceImageOnCanvas,
} from '../utils/background-removal';
import { smartCrop } from '../utils/smart-crop';
import clsx from 'clsx';
import {
  StudioIcon,
  StudioIconName,
} from '@gitroom/frontend/components/studio/studio-icons';

interface ToolbarProps {
  canvas: MutableRefObject<fabric.Canvas | null>;
}

type ShapeType =
  | 'rect'
  | 'circle'
  | 'triangle'
  | 'star'
  | 'hexagon'
  | 'heart'
  | 'arrow'
  | 'speech'
  | 'line'
  | 'diamond'
  | 'pentagon'
  | 'plus'
  | 'lightning'
  | 'ring'
  | 'parallelogram';

const SHAPE_BUTTONS: {
  type: ShapeType;
  icon: StudioIconName;
  titleKey: string;
  fallback: string;
}[] = [
  { type: 'rect', icon: 'shapeRect', titleKey: 'shape_rect', fallback: 'Rectangle' },
  { type: 'circle', icon: 'shapeCircle', titleKey: 'shape_circle', fallback: 'Circle' },
  { type: 'triangle', icon: 'shapeTriangle', titleKey: 'shape_triangle', fallback: 'Triangle' },
  { type: 'star', icon: 'shapeStar', titleKey: 'shape_star', fallback: 'Star' },
  { type: 'hexagon', icon: 'shapeHexagon', titleKey: 'shape_hexagon', fallback: 'Hexagon' },
  { type: 'heart', icon: 'shapeHeart', titleKey: 'shape_heart', fallback: 'Heart' },
  { type: 'arrow', icon: 'shapeArrow', titleKey: 'shape_arrow', fallback: 'Arrow' },
  { type: 'speech', icon: 'shapeSpeech', titleKey: 'shape_speech', fallback: 'Speech bubble' },
  { type: 'line', icon: 'shapeLine', titleKey: 'shape_line', fallback: 'Line' },
  { type: 'diamond', icon: 'shapeDiamond', titleKey: 'shape_diamond', fallback: 'Diamond' },
  { type: 'pentagon', icon: 'shapePentagon', titleKey: 'shape_pentagon', fallback: 'Pentagon' },
  { type: 'plus', icon: 'shapePlus', titleKey: 'shape_plus', fallback: 'Plus' },
  { type: 'lightning', icon: 'shapeLightning', titleKey: 'shape_lightning', fallback: 'Lightning' },
  { type: 'ring', icon: 'shapeRing', titleKey: 'shape_ring', fallback: 'Ring' },
  { type: 'parallelogram', icon: 'shapeParallelogram', titleKey: 'shape_parallelogram', fallback: 'Parallelogram' },
];

const BG_COLORS = [
  '#0a0e1a',
  '#1a1a2e',
  '#16213e',
  '#0f3460',
  '#533483',
  '#1f1147',
  '#0d3b66',
  '#264653',
  '#2a9d8f',
  '#e76f51',
  '#e94560',
  '#f4a261',
  '#fbbf24',
  '#10b981',
  '#38bdf8',
  '#a78bfa',
  '#ffffff',
  '#000000',
];

const TOOLS: {
  key: EditorTool;
  icon: StudioIconName;
  labelKey: string;
  fallback: string;
}[] = [
  { key: 'ai', icon: 'aiGenerate', labelKey: 'tool_ai', fallback: 'AI Generate' },
  { key: 'refine', icon: 'aiRefine', labelKey: 'tool_refine', fallback: 'AI Refine' },
  { key: 'templates', icon: 'templates', labelKey: 'tool_templates', fallback: 'Templates' },
  // Stock sat at the bottom of the Images panel: four clicks and a typed query
  // before a user saw a single photo, for the one feature here that costs
  // nothing and needs no AI credit. It is a source of content like Templates,
  // so it belongs next to it on the bar.
  { key: 'stock', icon: 'stock', labelKey: 'tool_stock', fallback: 'Stock photos' },
  { key: 'brand', icon: 'brand', labelKey: 'tool_brand', fallback: 'Brand Kit' },
  { key: 'select', icon: 'select', labelKey: 'tool_select', fallback: 'Select' },
  { key: 'text', icon: 'text', labelKey: 'tool_text', fallback: 'Text' },
  { key: 'shapes', icon: 'shapes', labelKey: 'tool_shapes', fallback: 'Shapes' },
  { key: 'icons', icon: 'icons', labelKey: 'tool_icons', fallback: 'Icons' },
  { key: 'images', icon: 'images', labelKey: 'tool_images', fallback: 'Images' },
  { key: 'layers', icon: 'layers', labelKey: 'tool_layers', fallback: 'Layers' },
];

export const EditorToolbar: FC<ToolbarProps> = ({ canvas }) => {
  const {
    activeTool,
    setTool,
    bgColor,
    setBgColor,
    platform,
    canvasReady,
    panelOpen,
    setPanelOpen,
  } = useEditorStore();
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [defaultFontFamily, setDefaultFontFamily] = useState<string>(
    DEFAULT_FONT.family
  );
  const [removingBg, setRemovingBg] = useState(false);
  /** Manual crop is a mode: a frame sits on the canvas until it is applied or
   *  cancelled, and the rest of the toolbar keeps working around it. */
  const [cropping, setCropping] = useState(false);
  const cropFrameRef = useRef<fabric.Rect | null>(null);
  const cropTargetRef = useRef<fabric.FabricImage | null>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [bgProgress, setBgProgress] = useState(0);

  // Image tools shouldn't demand a manual selection: if nothing (or a
  // non-image) is selected, grab the topmost image on the canvas — users add
  // a stock photo and immediately click "Remove background" while the import
  // hasn't been re-selected, then read the old toast as "it can't see my image".
  const resolveTargetImage = useCallback((): fabric.FabricImage | null => {
    const c = canvas.current;
    if (!c) return null;
    const active = c.getActiveObject();
    if (active instanceof fabric.FabricImage) return active;
    const images = c.getObjects().filter(
      (o): o is fabric.FabricImage => o instanceof fabric.FabricImage
    );
    if (!images.length) return null;
    const img = images[images.length - 1];
    c.setActiveObject(img);
    c.renderAll();
    return img;
  }, [canvas]);

  const cropSelectedImage = useCallback(async () => {
    if (!canvas.current) return;
    const active = resolveTargetImage();
    if (!active) {
      toaster.show(
        t('crop_no_image', 'Add an image to the canvas first'),
        'warning'
      );
      return;
    }
    const el = active.getElement();
    if (!(el instanceof HTMLImageElement) || !el.src) {
      toaster.show(t('crop_no_image', 'Add an image to the canvas first'), 'warning');
      return;
    }

    try {
      const targetAspect = platform.width / platform.height;
      const { dataUrl } = await smartCrop(el.src, targetAspect);
      await replaceImageOnCanvas(canvas.current, active, dataUrl);
    } catch {
      toaster.show(
        t('crop_failed', 'Smart crop failed.'),
        'warning'
      );
    }
  }, [canvas, platform, toaster, t, resolveTargetImage]);

  /** The image as the crop maths wants it: a box on the canvas plus the source
   *  window it is showing. */
  const readCroppable = (img: fabric.FabricImage): CroppableImage => {
    const rect = img.getBoundingRect();
    const el = img.getElement() as HTMLImageElement;
    return {
      left: rect.left,
      top: rect.top,
      width: img.width || 1,
      height: img.height || 1,
      cropX: img.cropX || 0,
      cropY: img.cropY || 0,
      scaleX: img.scaleX || 1,
      scaleY: img.scaleY || 1,
      sourceWidth: el?.naturalWidth || img.width || 1,
      sourceHeight: el?.naturalHeight || img.height || 1,
    };
  };

  const clearCropFrame = useCallback(() => {
    const c = canvas.current;
    if (c && cropFrameRef.current) c.remove(cropFrameRef.current);
    cropFrameRef.current = null;
    cropTargetRef.current = null;
    setCropping(false);
    c?.requestRenderAll();
  }, [canvas]);

  const startCrop = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const img = resolveTargetImage();
    if (!img) {
      toaster.show(t('crop_no_image', 'Add an image to the canvas first'), 'warning');
      return;
    }
    // A rotated image would need the frame rotated with it; the maths below
    // works in canvas axes, so say so instead of cropping the wrong pixels.
    if (Math.round(img.angle || 0) % 360 !== 0) {
      toaster.show(
        t('crop_rotate_first', 'Set the rotation back to 0° before cropping this image.'),
        'warning'
      );
      return;
    }
    const start = initialCropRect(readCroppable(img));
    const frame = new fabric.Rect({
      ...start,
      originX: 'left',
      originY: 'top',
      fill: 'rgba(56,189,248,0.12)',
      stroke: '#38bdf8',
      strokeWidth: 2,
      strokeUniform: true,
      strokeDashArray: [6, 4],
      hasRotatingPoint: false,
      lockRotation: true,
      excludeFromExport: true,
    });
    cropFrameRef.current = frame;
    cropTargetRef.current = img;
    c.add(frame);
    c.setActiveObject(frame);
    c.requestRenderAll();
    setCropping(true);
  }, [canvas, resolveTargetImage, t, toaster]);

  const applyCrop = useCallback(() => {
    const c = canvas.current;
    const frame = cropFrameRef.current;
    const img = cropTargetRef.current;
    if (!c || !frame || !img) return;
    const rect = frame.getBoundingRect();
    const next = cropFromRect(readCroppable(img), {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    });
    img.set({ cropX: next.cropX, cropY: next.cropY, width: next.width, height: next.height });
    img.setXY(new fabric.Point(next.left, next.top), 'left', 'top');
    img.setCoords();
    clearCropFrame();
    c.setActiveObject(img);
    c.fire('object:modified', { target: img } as fabric.ModifiedEvent);
    c.requestRenderAll();
  }, [canvas, clearCropFrame]);

  const undoCrop = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const img = resolveTargetImage();
    if (!img) return;
    const next = resetCrop(readCroppable(img));
    img.set({ cropX: 0, cropY: 0, width: next.width, height: next.height });
    img.setXY(new fabric.Point(next.left, next.top), 'left', 'top');
    img.setCoords();
    c.fire('object:modified', { target: img } as fabric.ModifiedEvent);
    c.requestRenderAll();
  }, [canvas, resolveTargetImage]);

  /** Swap the pixels, keep the frame the design was built around. */
  const replaceImage = useCallback(
    async (file: File) => {
      const c = canvas.current;
      if (!c) return;
      const img = resolveTargetImage();
      if (!img) {
        toaster.show(t('crop_no_image', 'Add an image to the canvas first'), 'warning');
        return;
      }
      const url = URL.createObjectURL(file);
      try {
        await replaceImageOnCanvas(c, img, url, 'cover');
        c.fire('object:modified', { target: c.getActiveObject()! } as fabric.ModifiedEvent);
      } catch {
        toaster.show(t('image_replace_failed', 'Could not load that image.'), 'warning');
      } finally {
        URL.revokeObjectURL(url);
      }
    },
    [canvas, resolveTargetImage, t, toaster]
  );

  const removeImageBackground = useCallback(async () => {
    if (!canvas.current || removingBg) return;
    const active = resolveTargetImage();
    if (!active) {
      toaster.show(
        t('bg_remove_no_image', 'Add an image to the canvas first'),
        'warning'
      );
      return;
    }
    const sourceEl = active.getElement();
    if (!(sourceEl instanceof HTMLImageElement)) {
      toaster.show(
        t('bg_remove_no_image', 'Add an image to the canvas first'),
        'warning'
      );
      return;
    }

    setRemovingBg(true);
    setBgProgress(0);
    try {
      const newSrc = await removeBackgroundFromImage(sourceEl, {
        onProgress: (p) => setBgProgress(p),
      });
      await replaceImageOnCanvas(canvas.current, active, newSrc);
    } catch {
      toaster.show(
        t('bg_remove_failed', 'Background removal failed'),
        'warning'
      );
    } finally {
      setRemovingBg(false);
      setBgProgress(0);
    }
  }, [canvas, removingBg, toaster, t, resolveTargetImage]);

  const addText = useCallback(async () => {
    if (!canvas.current) return;
    // Fabric measures the textbox as it is created and keeps those metrics. A
    // font that arrives a moment later would leave the box sized for the
    // fallback, so wait for the family first.
    await ensureFontsLoaded([defaultFontFamily]);
    if (!canvas.current) return;
    const cx = canvas.current.getWidth() / canvas.current.getZoom() / 2;
    const cy = canvas.current.getHeight() / canvas.current.getZoom() / 2;
    const text = new fabric.Textbox(t('text_placeholder', 'Type your text'), {
      left: cx,
      top: cy,
      width: 300,
      fontSize: 48,
      fontFamily: defaultFontFamily,
      fill: '#ffffff',
      textAlign: 'center',
      editable: true,
    });
    canvas.current.add(text);
    canvas.current.setActiveObject(text);
    canvas.current.renderAll();
  }, [canvas, defaultFontFamily, t]);

  const applyFontToSelection = useCallback(
    async (family: string) => {
      setDefaultFontFamily(family);
      if (!canvas.current) return;
      // Same reason as in addText: without the face in the document the
      // reflow below measures the fallback and caches it.
      await ensureFontsLoaded([family]);
      if (!canvas.current) return;
      const active = canvas.current.getActiveObjects();
      let touched = false;
      active.forEach((obj) => {
        if (obj instanceof fabric.Textbox || obj instanceof fabric.IText) {
          obj.set({ fontFamily: family });
          touched = true;
        }
      });
      if (touched) canvas.current.renderAll();
    },
    [canvas]
  );

  const addShape = useCallback(
    (type: ShapeType) => {
      if (!canvas.current) return;
      const cx = canvas.current.getWidth() / canvas.current.getZoom() / 2;
      const cy = canvas.current.getHeight() / canvas.current.getZoom() / 2;

      let obj: fabric.FabricObject;
      switch (type) {
        case 'rect':
          obj = new fabric.Rect({
            left: cx,
            top: cy,
            width: 150,
            height: 150,
            fill: '#38bdf8',
            rx: 8,
            ry: 8,
            originX: 'center',
            originY: 'center',
          });
          break;
        case 'circle':
          obj = new fabric.Circle({
            left: cx,
            top: cy,
            radius: 80,
            fill: '#a78bfa',
            originX: 'center',
            originY: 'center',
          });
          break;
        case 'triangle':
          obj = new fabric.Triangle({
            left: cx,
            top: cy,
            width: 160,
            height: 140,
            fill: '#38bdf8',
            originX: 'center',
            originY: 'center',
          });
          break;
        case 'star': {
          const r1 = 80;
          const r2 = 35;
          const points: fabric.XY[] = [];
          for (let i = 0; i < 10; i++) {
            const r = i % 2 === 0 ? r1 : r2;
            const a = (Math.PI / 5) * i - Math.PI / 2;
            points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
          }
          obj = new fabric.Polygon(points, {
            left: cx,
            top: cy,
            fill: '#fbbf24',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'hexagon': {
          const r = 80;
          const points: fabric.XY[] = [];
          for (let i = 0; i < 6; i++) {
            const a = (Math.PI / 3) * i - Math.PI / 2;
            points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
          }
          obj = new fabric.Polygon(points, {
            left: cx,
            top: cy,
            fill: '#10b981',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'heart': {
          const path =
            'M 0 -30 C -15 -55 -55 -55 -55 -20 C -55 10 -25 30 0 60 C 25 30 55 10 55 -20 C 55 -55 15 -55 0 -30 Z';
          obj = new fabric.Path(path, {
            left: cx,
            top: cy,
            fill: '#ef4444',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'arrow': {
          const path = 'M 0 -15 L 80 -15 L 80 -35 L 130 0 L 80 35 L 80 15 L 0 15 Z';
          obj = new fabric.Path(path, {
            left: cx,
            top: cy,
            fill: '#38bdf8',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'speech': {
          const path =
            'M -90 -60 L 90 -60 Q 110 -60 110 -40 L 110 30 Q 110 50 90 50 L -30 50 L -60 80 L -50 50 L -90 50 Q -110 50 -110 30 L -110 -40 Q -110 -60 -90 -60 Z';
          obj = new fabric.Path(path, {
            left: cx,
            top: cy,
            fill: '#a78bfa',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'diamond': {
          const points: fabric.XY[] = [
            { x: 0, y: -85 },
            { x: 65, y: 0 },
            { x: 0, y: 85 },
            { x: -65, y: 0 },
          ];
          obj = new fabric.Polygon(points, {
            left: cx,
            top: cy,
            fill: '#e94560',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'pentagon': {
          const r = 85;
          const points: fabric.XY[] = [];
          for (let i = 0; i < 5; i++) {
            const a = ((Math.PI * 2) / 5) * i - Math.PI / 2;
            points.push({ x: Math.cos(a) * r, y: Math.sin(a) * r });
          }
          obj = new fabric.Polygon(points, {
            left: cx,
            top: cy,
            fill: '#f4a261',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'plus': {
          const path =
            'M -25 -75 L 25 -75 L 25 -25 L 75 -25 L 75 25 L 25 25 L 25 75 L -25 75 L -25 25 L -75 25 L -75 -25 L -25 -25 Z';
          obj = new fabric.Path(path, {
            left: cx,
            top: cy,
            fill: '#10b981',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'lightning': {
          const path = 'M 10 -80 L -45 10 L -8 10 L -20 80 L 45 -15 L 8 -15 Z';
          obj = new fabric.Path(path, {
            left: cx,
            top: cy,
            fill: '#fbbf24',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'ring':
          obj = new fabric.Circle({
            left: cx,
            top: cy,
            radius: 70,
            fill: 'transparent',
            stroke: '#38bdf8',
            strokeWidth: 22,
            originX: 'center',
            originY: 'center',
          });
          break;
        case 'parallelogram': {
          const points: fabric.XY[] = [
            { x: -55, y: -55 },
            { x: 85, y: -55 },
            { x: 55, y: 55 },
            { x: -85, y: 55 },
          ];
          obj = new fabric.Polygon(points, {
            left: cx,
            top: cy,
            fill: '#a78bfa',
            originX: 'center',
            originY: 'center',
          });
          break;
        }
        case 'line':
        default:
          obj = new fabric.Line([cx - 100, cy, cx + 100, cy], {
            stroke: '#ffffff',
            strokeWidth: 4,
          });
          break;
      }
      canvas.current.add(obj!);
      canvas.current.setActiveObject(obj!);
      canvas.current.renderAll();
    },
    [canvas]
  );

  const addImage = useCallback(
    async (file: File) => {
      if (!canvas.current) return;
      setUploading(true);
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        });
        const { path } = await res.json();

        const imgEl = new Image();
        imgEl.crossOrigin = 'anonymous';
        imgEl.onload = () => {
          if (!canvas.current) return;
          const img = new fabric.FabricImage(imgEl);
          const canvasW = canvas.current.getWidth() / canvas.current.getZoom();
          const canvasH = canvas.current.getHeight() / canvas.current.getZoom();
          const scale = Math.min(canvasW / img.width!, canvasH / img.height!, 1);
          img.set({
            scaleX: scale,
            scaleY: scale,
            left: canvasW / 2,
            top: canvasH / 2,
            selectable: true,
            evented: true,
            hasControls: true,
            hasBorders: true,
          });
          canvas.current.add(img);
          canvas.current.setActiveObject(img);
          canvas.current.renderAll();
        };
        imgEl.onerror = () =>
          toaster.show(t('image_load_failed', 'Failed to load image'), 'warning');
        imgEl.src = path;
      } catch {
        toaster.show(t('upload_failed', 'Image upload failed'), 'warning');
      } finally {
        setUploading(false);
      }
    },
    [canvas, fetch, toaster, t]
  );

  const setBackground = useCallback(
    (color: string) => {
      if (!canvas.current) return;
      setBgColor(color);
      canvas.current.backgroundColor = color;
      canvas.current.renderAll();
    },
    [canvas, setBgColor]
  );

  /** A flat colour behind a headline reads as unfinished, and every template
   *  that looks good uses a gradient. This builds one from the colour already
   *  chosen, so it stays on brand: that colour at the top, a darker version of
   *  it at the bottom. */
  const applyGradientBackground = useCallback(() => {
    const c = canvas.current;
    if (!c) return;
    const top = bgColor || '#1a1a2e';
    c.backgroundColor = new fabric.Gradient({
      type: 'linear',
      gradientUnits: 'pixels',
      coords: { x1: 0, y1: 0, x2: 0, y2: platform.height },
      colorStops: [
        { offset: 0, color: top },
        { offset: 1, color: blend(top, '#000000', 0.55) },
      ],
    });
    c.renderAll();
    c.fire('object:modified', { target: c.getObjects()[0] } as fabric.ModifiedEvent);
  }, [canvas, bgColor, platform.height]);

  // The colour swatches recolour whatever is selected; only with nothing
  // selected do they fall back to the canvas background. Users kept reading
  // the old always-background behaviour as "these colours do nothing".
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const update = () => setHasSelection(!!c.getActiveObject());
    c.on('selection:created', update);
    c.on('selection:updated', update);
    c.on('selection:cleared', update);
    update();
    return () => {
      c.off('selection:created', update);
      c.off('selection:updated', update);
      c.off('selection:cleared', update);
    };
  }, [canvas, canvasReady]);

  const applyColor = useCallback(
    (color: string) => {
      const c = canvas.current;
      if (!c) return;
      const active = c.getActiveObjects();
      if (active.length) {
        // Fabric's SVG parser turns fill="none" into an EMPTY STRING, not
        // "transparent", so every Tabler icon fell through to the fill branch:
        // single-path icons got an inside-out blob and grouped ones a no-op.
        const isStrokeDrawn = (o: fabric.FabricObject) =>
          o.type === 'line' ||
          ((o.fill === 'transparent' || o.fill === '' || o.fill == null) && !!o.stroke);
        const recolour = (o: fabric.FabricObject) => {
          // An icon arrives as a Group of paths; setting fill on the group
          // itself changes nothing, so reach the paths inside.
          const children = (o as unknown as { getObjects?: () => fabric.FabricObject[] })
            .getObjects?.();
          if (children?.length) {
            children.forEach(recolour);
            return;
          }
          if (isStrokeDrawn(o)) o.set({ stroke: color });
          else o.set({ fill: color });
        };
        active.forEach(recolour);
        c.renderAll();
        c.fire('object:modified', { target: active[0] } as never);
        return;
      }
      setBackground(color);
    },
    [canvas, setBackground]
  );

  const handleToolClick = useCallback(
    (tool: EditorTool) => {
      const wasActive = activeTool === tool;
      // Clicking the tool you are already on closes the drawer, the way every
      // editor with an icon rail behaves - and it is the only way back to a
      // full-width canvas without hunting for the collapse arrow.
      if (wasActive && tool !== 'text') {
        setPanelOpen(!panelOpen);
        return;
      }
      setTool(tool);
      if (tool === 'text' && !wasActive) void addText();
    },
    [activeTool, setTool, addText, panelOpen, setPanelOpen]
  );

  // Every tool keeps the side panel open — collapsing it for Select made the
  // whole layout jump, which users read as the editor restarting.
  const hasPanel = true;

  return (
    <div className="flex h-full min-h-0 bg-white/[0.03] border-r border-newBorder shrink-0">
      {/* Icons only, 56px: with a label under every icon the rail needed 100px
          and eleven tools still ran past the bottom of a laptop window, so the
          last one - Layers - could only be reached by scrolling the rail. The
          name now arrives on hover and through aria-label. */}
      <div className="w-[56px] flex flex-col gap-1 p-2 shrink-0 overflow-y-auto border-r border-newBorder">
        {TOOLS.map((tool) => (
          <button
            key={tool.key}
            onClick={() => handleToolClick(tool.key)}
            title={t(tool.labelKey, tool.fallback)}
            aria-label={t(tool.labelKey, tool.fallback)}
            aria-pressed={activeTool === tool.key}
            data-tooltip-id="tooltip"
            data-tooltip-content={t(tool.labelKey, tool.fallback)}
            className={clsx(
              'flex items-center justify-center h-[40px] rounded-md transition-colors',
              activeTool === tool.key
                ? 'bg-newAccent text-[#06222e]'
                : 'text-textColor hover:bg-newColColor'
            )}
          >
            <StudioIcon name={tool.icon} size={20} />
          </button>
        ))}
      </div>

      {hasPanel && panelOpen && (
        <div className="w-[280px] shrink-0 p-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
        <div className="flex items-center justify-between -mb-1">
          <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
            {t(
              TOOLS.find((tool) => tool.key === activeTool)?.labelKey ?? 'tool_select',
              TOOLS.find((tool) => tool.key === activeTool)?.fallback ?? 'Select'
            )}
          </span>
          <button
            type="button"
            onClick={() => setPanelOpen(false)}
            title={t('panel_collapse', 'Hide this panel')}
            aria-label={t('panel_collapse', 'Hide this panel')}
            className="text-textColor/60 hover:text-textColor transition-colors px-1"
          >
            <StudioIcon name="collapse" size={16} />
          </button>
        </div>
        {activeTool === 'select' && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
              {t('tool_select', 'Select')}
            </span>
            <p className="text-[11px] leading-relaxed text-textColor/70">
              {t(
                'select_tool_hint',
                'Click any object on the canvas to select it. Drag to move, pull the corners to resize, use the handle above to rotate. Delete removes the selected object; Ctrl+Z undoes.'
              )}
            </p>
          </div>
        )}

        {activeTool === 'ai' && <AiGeneratePanel canvas={canvas} />}

        {activeTool === 'refine' && <AiRefinePanel canvas={canvas} />}

        {activeTool === 'brand' && <BrandKitPanel />}

        {activeTool === 'icons' && <IconsPanel canvas={canvas} />}

        {activeTool === 'layers' && <LayersPanel canvas={canvas} />}

        {activeTool === 'templates' && <TemplatesPanel canvas={canvas} />}

        {activeTool === 'text' && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
              {t('font_label', 'Font')}
            </span>
            <select
              value={findFontByFamily(defaultFontFamily).family}
              onChange={(e) => applyFontToSelection(e.target.value)}
              className="text-xs px-2 py-1.5 rounded bg-newColColor text-textColor border border-newBorder focus:outline-none focus:border-forth"
            >
              {STUDIO_FONTS.map((font) => (
                <option
                  key={font.key}
                  value={font.family}
                  style={{ fontFamily: font.family }}
                >
                  {font.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => void addText()}
              className="text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
            >
              + {t('text_add', 'Add text')}
            </button>
            <p className="text-[11px] text-textColor/65 leading-snug">
              {t(
                'text_font_hint',
                'Choose a font for new text. To change existing text — select it and pick a font.'
              )}
            </p>
          </div>
        )}

        {activeTool === 'shapes' && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
              {t('add_shape', 'Add shape')}
            </span>
            <div className="grid grid-cols-4 gap-1.5">
              {SHAPE_BUTTONS.map((shape) => (
                <button
                  key={shape.type}
                  onClick={() => addShape(shape.type)}
                  className="aspect-square rounded bg-newColColor hover:bg-white/[0.08] flex items-center justify-center text-textColor text-base transition-colors"
                  title={t(shape.titleKey, shape.fallback)}
                  aria-label={t(shape.titleKey, shape.fallback)}
                >
                  <StudioIcon name={shape.icon} size={20} />
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTool === 'images' && (
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
              {t('add_image', 'Add Image')}
            </span>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              {uploading
                ? t('uploading', 'Uploading…')
                : t('upload_image', 'Upload Image')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) addImage(file);
                e.target.value = '';
              }}
            />

            <button
              onClick={removeImageBackground}
              disabled={removingBg}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors disabled:opacity-50 disabled:cursor-wait"
            >
              <StudioIcon name="eraser" size={16} />
              {removingBg
                ? `${t('bg_remove_loading', 'Removing…')} ${Math.round(bgProgress * 100)}%`
                : t('bg_remove_button', 'Remove background')}
            </button>

            <button
              onClick={cropSelectedImage}
              title={t(
                'crop_smart_hint',
                'Crops the photo to the current format (bottom bar), keeping the most detailed part of the picture in frame'
              )}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
            >
              <StudioIcon name="crop" size={16} />
              {t('crop_smart', 'Smart crop to platform')}
            </button>

            {/* Manual crop: the smart one guesses, this one lets the user say
                exactly which part of the photo to keep. */}
            {!cropping ? (
              <button
                onClick={startCrop}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
              >
                <StudioIcon name="crop" size={16} />
                {t('crop_manual', 'Crop by hand')}
              </button>
            ) : (
              <div className="flex flex-col gap-1.5 p-2 rounded bg-white/[0.04] border border-newBorder">
                <span className="text-[12px] text-textColor/75 leading-snug">
                  {t(
                    'crop_manual_hint',
                    'Drag the frame over the part you want to keep, then apply.'
                  )}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={applyCrop}
                    className="flex-1 text-xs px-3 py-2 rounded bg-newAccent text-[#06222e] font-[600] hover:brightness-110 transition-all"
                  >
                    {t('crop_manual_apply', 'Apply crop')}
                  </button>
                  <button
                    onClick={clearCropFrame}
                    className="text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
                  >
                    {t('cancel', 'Cancel')}
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={undoCrop}
              title={t('crop_reset_hint', 'Show the whole photo again')}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
            >
              <StudioIcon name="undo" size={16} />
              {t('crop_reset', 'Reset crop')}
            </button>

            <button
              onClick={() => replaceRef.current?.click()}
              title={t(
                'image_replace_hint',
                'Swap the picture without touching the layout — the new one fills the same frame'
              )}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
            >
              <StudioIcon name="images" size={16} />
              {t('image_replace', 'Replace image')}
            </button>
            <input
              ref={replaceRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void replaceImage(file);
                e.target.value = '';
              }}
            />
            <p className="text-[11px] text-textColor/65 leading-snug">
              {t(
                'image_tools_hint',
                'Both work on the selected image (or the last one added). Remove background downloads an AI model (~30MB) on first run; Smart crop trims the photo to the current post format.'
              )}
            </p>

            <ImageFiltersPanel canvas={canvas} />

            <button
              onClick={() => setTool('stock')}
              className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors text-left"
            >
              <StudioIcon name="stock" size={16} />
              {t('image_stock_jump', 'Browse free stock photos')}
            </button>
          </div>
        )}

        {activeTool === 'stock' && (
          <StockImagesPanel canvas={canvas} defaultQuery="business" />
        )}

        {(activeTool === 'shapes' ||
          activeTool === 'images' ||
          activeTool === 'select' ||
          activeTool === 'text') && (
          <>
          <div className="flex flex-col gap-2">
            <span className="text-[11px] text-textColor/60 uppercase tracking-wide">
              {hasSelection
                ? t('fill_selected', 'Colour of selected object')
                : t('background', 'Background')}
            </span>
            {!hasSelection && (
              <p className="text-[11px] text-textColor/65 leading-snug">
                {t(
                  'fill_hint',
                  'Nothing selected — these colours set the canvas background. Select an object to recolour it.'
                )}
              </p>
            )}
            <div className="grid grid-cols-6 gap-1.5">
              {BG_COLORS.map((color) => (
                <button
                  key={color}
                  onClick={() => applyColor(color)}
                  className={clsx(
                    'w-7 h-7 rounded-full border-2 transition-transform hover:scale-110',
                    !hasSelection && bgColor === color
                      ? 'border-white scale-110'
                      : 'border-newBorder/40'
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={`${t('background', 'Background')} ${color}`}
                  title={color}
                />
              ))}
            </div>
            {!hasSelection && (
              <button
                onClick={applyGradientBackground}
                className="flex items-center gap-2 text-xs px-3 py-2 rounded bg-newColColor hover:bg-white/[0.08] text-textColor transition-colors"
                title={t(
                  'background_gradient_hint',
                  'Fades the background colour into a darker shade of itself'
                )}
              >
                <StudioIcon name="gradient" size={16} />
                {t('background_gradient', 'Gradient background')}
              </button>
            )}
            <input
              type="color"
              value={bgColor}
              onChange={(e) => applyColor(e.target.value)}
              className="w-full h-7 rounded cursor-pointer border-0 bg-transparent"
              aria-label={t('background_custom', 'Custom color')}
            />
          </div>

          </>
        )}
        </div>
      )}
    </div>
  );
};
