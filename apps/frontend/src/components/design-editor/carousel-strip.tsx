'use client';

import { FC, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import { useCarouselStore, CarouselSlide } from './carousel.store';
import { useEditorStore } from './editor.store';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { loadCanvasFonts } from './utils/font-loading';

const THUMB_W = 80;
const THUMB_H = 100;

const SlideThumb: FC<{ slide: CarouselSlide; sourceWidth: number; sourceHeight: number }> = ({
  slide,
  sourceWidth,
  sourceHeight,
}) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  // Render offscreen, the way template thumbnails do. Rendering into a mounted
  // <canvas> meant that as soon as a thumbnail existed the element was replaced
  // by the <img>, so the next time the slide changed the ref was null, the
  // effect bailed, and the thumbnail stayed blank — which is what happened
  // after every slide switch and every "Apply layout to all".
  useEffect(() => {
    if (!slide.canvasJson) {
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    const c = new fabric.StaticCanvas(undefined, {
      width: THUMB_W,
      height: THUMB_H,
      backgroundColor: '#1a1a2e',
      renderOnAddRemove: false,
    });
    const scale = Math.min(THUMB_W / sourceWidth, THUMB_H / sourceHeight);
    c.setZoom(scale);
    c.loadFromJSON(slide.canvasJson)
      .then(async () => {
        await loadCanvasFonts(c);
        c.renderAll();
        if (!cancelled) {
          setDataUrl(c.toDataURL({ format: 'jpeg', quality: 0.7, multiplier: 1 }));
        }
      })
      .catch(() => {
        if (!cancelled) setDataUrl(null);
      })
      .finally(() => {
        void c.dispose();
      });
    return () => {
      cancelled = true;
    };
  }, [slide.canvasJson, sourceWidth, sourceHeight]);

  return (
    <div className="w-[80px] h-[100px] bg-white/[0.03] rounded overflow-hidden flex items-center justify-center">
      {dataUrl && <img src={dataUrl} alt="" className="w-full h-full object-contain" />}
    </div>
  );
};

interface CarouselStripProps {
  fabricRef: React.RefObject<fabric.Canvas | null>;
}

export const CarouselStrip: FC<CarouselStripProps> = ({ fabricRef }) => {
  const t = useT();
  const platform = useEditorStore((s) => s.platform);
  const {
    isCarouselMode,
    slides,
    currentSlideIndex,
    enterCarouselMode,
    exitCarouselMode,
    addSlide,
    duplicateSlide,
    deleteSlide,
    reorderSlides,
    requestSlideSwitch,
    applyLayoutToAll,
  } = useCarouselStore();

  const [dragIndex, setDragIndex] = useState<number | null>(null);

  if (!isCarouselMode) {
    return (
      <div className="border-t border-newBorder px-4 py-2 flex items-center justify-between bg-newBgColor">
        <div className="text-xs text-textColor opacity-70">
          {t('carousel_hint', 'Create a multi-slide post (Instagram / LinkedIn carousel — up to 10 slides)')}
        </div>
        <button
          onClick={() => {
            const json = fabricRef.current ? JSON.stringify(fabricRef.current.toJSON()) : null;
            enterCarouselMode(json);
          }}
          className="px-3 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors"
          title={t('carousel_enter_hint', 'Enable carousel mode — the current canvas becomes Slide 1')}
        >
          <StudioIcon name="carousel" size={14} />
          {t('carousel_enter', 'Carousel mode')}
        </button>
      </div>
    );
  }

  const onDragStart = (i: number) => setDragIndex(i);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (i: number) => {
    if (dragIndex === null || dragIndex === i) return;
    reorderSlides(dragIndex, i);
    setDragIndex(null);
  };

  const handleApplyLayoutToAll = () => {
    if (!fabricRef.current) return;
    const json = JSON.stringify(fabricRef.current.toJSON());
    applyLayoutToAll(json);
  };

  return (
    <div className="border-t border-newBorder bg-newBgColor">
      <div className="px-4 py-2 flex items-center justify-between">
        <div className="text-xs text-textColor">
          <StudioIcon name="carousel" size={14} />
          {t('carousel_label', 'Carousel')} —{' '}
          <span className="opacity-70">
            {t('carousel_slide_count', 'Slide {current} of {total}')
              .replace('{current}', String(currentSlideIndex + 1))
              .replace('{total}', String(slides.length))}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => addSlide(null)}
            disabled={slides.length >= 10}
            className="px-2 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30 transition-colors"
            title={t('carousel_add_hint', 'Add an empty slide (max 10)')}
          >
            + {t('carousel_add', 'Slide')}
          </button>
          <button
            onClick={() =>
              duplicateSlide(
                currentSlideIndex,
                fabricRef.current
                  ? JSON.stringify(fabricRef.current.toJSON())
                  : null
              )
            }
            disabled={slides.length >= 10}
            className="px-2 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30 transition-colors"
            title={t('carousel_duplicate_hint', 'Copy the current slide')}
          >
            <StudioIcon name="duplicate" size={13} />
            {t('carousel_duplicate', 'Duplicate')}
          </button>
          <button
            onClick={handleApplyLayoutToAll}
            className="px-2 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors"
            title={t('carousel_apply_all_hint', 'Copy the current slide layout to all slides (keeps brand consistency)')}
          >
            <StudioIcon name="templates" size={13} />
            {t('carousel_apply_all', 'Apply layout')}
          </button>
          <button
            onClick={exitCarouselMode}
            className="px-2 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-red-500 hover:text-white transition-colors"
            title={t('carousel_exit_hint', 'Exit carousel mode (slides will be lost)')}
          >
            <StudioIcon name="close" size={13} />
            {t('carousel_exit', 'Exit')}
          </button>
        </div>
      </div>
      <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
        {slides.map((slide, i) => {
          const isActive = i === currentSlideIndex;
          return (
            <div
              key={slide.id}
              draggable
              onDragStart={() => onDragStart(i)}
              onDragOver={onDragOver}
              onDrop={() => onDrop(i)}
              onClick={() => requestSlideSwitch(i)}
              className={`relative flex-shrink-0 cursor-pointer rounded transition-all ${
                isActive
                  ? 'ring-2 ring-newAccent shadow-lg'
                  : 'ring-1 ring-newBorder opacity-70 hover:opacity-100'
              }`}
              title={t('carousel_switch_to', 'Go to Slide {n}').replace('{n}', String(i + 1))}
            >
              <SlideThumb
                slide={slide}
                sourceWidth={platform.width}
                sourceHeight={platform.height}
              />
              <div className="absolute top-0 left-0 bg-black/70 text-white text-[11px] px-1 rounded-br">
                {i + 1}
              </div>
              {slides.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSlide(i);
                  }}
                  className="absolute top-0 right-0 bg-black/70 text-white text-[11px] w-4 h-4 rounded-bl hover:bg-red-500 flex items-center justify-center"
                  title={t('carousel_delete_slide', 'Delete this slide')}
                >
                  <StudioIcon name="close" size={11} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
