import * as fabric from 'fabric';
import { PlatformSize } from '../editor.store';
import { ensureFontsLoaded } from './font-loading';
import {
  PostDesignSpec,
  computeLayout,
  computeDesignFontSizes,
  DESIGN_TEXT_FONT,
  DESIGN_TEXTBOX_WIDTH,
} from '@gitroom/nestjs-libraries/studio/post-design-spec';

// The `PostDesignSpec` type and layout maths live in a shared, DOM-free module
// so the server-side renderer (`design-render.service.ts`) computes identical
// positions. Re-exported here so existing importers keep working.
export type { PostDesignSpec };

const TEXT_FONT = DESIGN_TEXT_FONT;

const buildGradient = (color: string, width: number, height: number) =>
  new fabric.Gradient({
    type: 'linear',
    coords: { x1: 0, y1: 0, x2: 0, y2: height },
    colorStops: [
      { offset: 0, color: color },
      { offset: 1, color: '#000000' },
    ],
  });

export const renderDesignSpec = async (
  canvas: fabric.Canvas,
  spec: PostDesignSpec,
  platform: PlatformSize
) => {
  canvas.clear();

  // Same brand font the server-side renderer draws with. Loading it before the
  // text objects exist is what makes the two agree on where the lines break.
  await ensureFontsLoaded([TEXT_FONT]);

  const { width, height } = platform;
  const positions = computeLayout(spec.layout, width, height);
  const fontSizes = computeDesignFontSizes(width);
  const headlineFontSize = fontSizes.headline;
  const subtextFontSize = fontSizes.subtext;
  const ctaFontSize = fontSizes.cta;

  // 1. Background gradient placeholder (immediate)
  const bgRect = new fabric.Rect({
    left: 0,
    top: 0,
    width,
    height,
    fill: buildGradient(spec.colors.background, width, height),
    selectable: false,
    evented: false,
    originX: 'left',
    originY: 'top',
  });
  canvas.add(bgRect);

  // 2. Text layers (immediate)
  const headline = new fabric.Textbox(spec.headline, {
    ...positions.headline,
    width: width * DESIGN_TEXTBOX_WIDTH.headline,
    fontSize: headlineFontSize,
    fontFamily: TEXT_FONT,
    fontWeight: '700',
    fill: spec.colors.text,
    shadow: new fabric.Shadow({
      color: 'rgba(0,0,0,0.5)',
      blur: 8,
      offsetX: 0,
      offsetY: 2,
    }),
  });
  const subtext = new fabric.Textbox(spec.subtext, {
    ...positions.subtext,
    width: width * DESIGN_TEXTBOX_WIDTH.subtext,
    fontSize: subtextFontSize,
    fontFamily: TEXT_FONT,
    fill: spec.colors.text,
    opacity: 0.9,
  });
  const cta = new fabric.Textbox(spec.cta, {
    ...positions.cta,
    width: width * DESIGN_TEXTBOX_WIDTH.cta,
    fontSize: ctaFontSize,
    fontFamily: TEXT_FONT,
    fontWeight: '600',
    fill: spec.colors.accent,
    backgroundColor: 'rgba(255,255,255,0.08)',
  });

  canvas.add(headline);
  canvas.add(subtext);
  canvas.add(cta);
  canvas.renderAll();

  // 3. Background image (async — swap once loaded)
  try {
    const imgEl = new Image();
    imgEl.crossOrigin = 'anonymous';
    await new Promise<void>((resolve, reject) => {
      imgEl.onload = () => resolve();
      imgEl.onerror = () => reject(new Error('background image load failed'));
      imgEl.src = spec.backgroundUrl;
    });

    const bgImg = new fabric.FabricImage(imgEl, {
      left: 0,
      top: 0,
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
    });
    bgImg.scaleToWidth(width);
    if (bgImg.getScaledHeight() < height) {
      bgImg.scaleToHeight(height);
    }

    canvas.remove(bgRect);
    // Keep at index 0 so text stays on top
    canvas.insertAt(0, bgImg);
    canvas.renderAll();
  } catch (err) {
    // Gradient placeholder remains — usable design
    console.warn('Background image swap skipped:', err);
  }

  // 4. Brand logo bottom-right (optional, async)
  if (spec.brandKit?.logoPath) {
    try {
      const logoEl = new Image();
      logoEl.crossOrigin = 'anonymous';
      await new Promise<void>((resolve, reject) => {
        logoEl.onload = () => resolve();
        logoEl.onerror = () => reject(new Error('logo load failed'));
        logoEl.src = spec.brandKit!.logoPath!;
      });

      const logo = new fabric.FabricImage(logoEl, { selectable: true });
      const logoTargetWidth = width * 0.12;
      const padding = width * 0.04;
      logo.scaleToWidth(logoTargetWidth);
      logo.set({
        left: width - padding,
        top: height - padding,
        originX: 'right',
        originY: 'bottom',
      });
      canvas.add(logo);
      canvas.renderAll();
    } catch (err) {
      console.warn('Logo placement skipped:', err);
    }
  }
};
