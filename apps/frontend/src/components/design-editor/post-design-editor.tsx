'use client';

import { FC, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import clsx from 'clsx';
import { useEditorStore, PLATFORM_SIZES, PlatformSize } from './editor.store';
import { useCarouselStore } from './carousel.store';
import { EditorToolbar } from './toolbar/editor-toolbar';
import { FormatBar } from './toolbar/format-bar';
import { CarouselStrip } from './carousel-strip';
import { WelcomeModal } from './welcome-modal';
import { repositionObjectFromTo } from './utils/multi-format-renderer';
import {
  installStudioFabricMetadata,
  wireStudioIds,
} from './utils/fabric-studio-metadata';
import { installStudioFabricControls } from './utils/fabric-controls';
import { computeSnap, edgesOf, SnapGuide } from './utils/canvas-snapping';
import { StudioIcon } from '@gitroom/frontend/components/studio/studio-icons';
import { renderDesignSpec, PostDesignSpec } from './utils/canvas-renderer';
import { withHistoryPaused, isHistoryPaused } from './utils/canvas-history';
import './fonts';

installStudioFabricMetadata();
installStudioFabricControls();

// A generated post design (flat headline/subtext/cta) versus a semantic
// StudioSpec (layer list) — they share the media `designSpec` column, told
// apart by shape.
const isPostDesignSpec = (spec: unknown): spec is PostDesignSpec =>
  !!spec &&
  typeof spec === 'object' &&
  'layout' in spec &&
  'headline' in spec &&
  'colors' in spec &&
  !('layers' in spec);
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useRouter } from 'next/navigation';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useUser } from '@gitroom/frontend/components/layout/user.context';
import { Button } from '@gitroom/frontend/components/ui/button';
import {
  readDraft,
  writeDraft,
  clearDraft,
} from './utils/draft-autosave';

const MultiFormatModal = lazy(() =>
  import('./multi-format-modal').then((m) => ({ default: m.MultiFormatModal }))
);

const HISTORY_EVENTS = ['object:modified', 'object:added', 'object:removed'] as const;

interface PostDesignEditorProps {
  setMedia: (params: { id: string; path: string }[]) => void;
  closeModal: () => void;
  width?: number;
  height?: number;
  mode?: 'composer' | 'studio';
  loadMediaId?: string;
}

// How much of the canvas area the artboard is allowed to take when fitted, so
// it never touches the edges of its container.
const CANVAS_FIT_PADDING = 32;
const MIN_ZOOM = 0.05;
/** Snap tolerance in screen pixels, converted to canvas units at use. */
const SNAP_THRESHOLD_PX = 7;
const MAX_ZOOM = 4;

const PostDesignEditor: FC<PostDesignEditorProps> = ({
  setMedia,
  closeModal,
  width,
  height,
  mode = 'composer',
  loadMediaId,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const [exporting, setExporting] = useState(false);
  const [savingToLibrary, setSavingToLibrary] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [multiFormatOpen, setMultiFormatOpen] = useState(false);
  const fetch = useFetch();
  const router = useRouter();
  const toaster = useToaster();
  const t = useT();
  const user = useUser();

  // Draft autosave (crash/refresh/tab-switch insurance). Refs, not state, so
  // the once-only canvas effect and its interval never see stale values.
  const orgIdRef = useRef('default');
  orgIdRef.current = user?.orgId || 'default';
  const [restoringDraft, setRestoringDraft] = useState(false);

  const { platform, setPlatform, pushHistory, setCanvasReady, setTool } =
    useEditorStore();
  const canvasReady = useEditorStore((s) => s.canvasReady);
  const canUndo = useEditorStore((s) => s.historyIndex > 0);
  const canRedo = useEditorStore((s) => s.historyIndex < s.history.length - 1);
  const carouselSlideCount = useCarouselStore((s) =>
    s.isCarouselMode ? s.slides.length : 0
  );

  /** The canvas area we have to draw into; measured, with a fallback for the
   *  first paint before the ResizeObserver has run. */
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportSizeRef = useRef({ width: 760, height: 560 });
  /** Zoom the user asked for. Null means "keep fitting me to the window". */
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const manualZoomRef = useRef<number | null>(null);
  const [zoomLabel, setZoomLabel] = useState(1);

  const fitScale = useCallback((p: PlatformSize) => {
    const { width, height } = viewportSizeRef.current;
    const usableW = Math.max(120, width - CANVAS_FIT_PADDING * 2);
    const usableH = Math.max(120, height - CANVAS_FIT_PADDING * 2);
    return Math.min(usableW / p.width, usableH / p.height);
  }, []);

  const getScale = useCallback(
    (p: PlatformSize) => manualZoomRef.current ?? fitScale(p),
    [fitScale]
  );

  const isRestoringRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const saveStateRef = useRef<(() => void) | null>(null);
  const prevPlatformRef = useRef(platform);
  /** Set once the design has been exported or saved — the draft is spent. */
  const draftDoneRef = useRef(false);
  /** Whether this editor ever held a design, so "empty" can be read correctly. */
  const hadContentRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const p = width && height ? { key: 'custom', label: 'Custom', width, height } : platform;
    if (width && height) setPlatform(p);

    const scale = getScale(p);
    const c = new fabric.Canvas(canvasRef.current, {
      width: p.width * scale,
      height: p.height * scale,
      backgroundColor: '#1a1a2e',
      selection: true,
    });

    c.setZoom(scale);

    // Without guides every layout in Studio is eyeballed. Snap the dragged
    // object to the edges and centres of the others and of the artboard, and
    // draw the line it matched on the overlay canvas.
    let guides: SnapGuide[] = [];
    c.on('object:moving', (e) => {
      const target = e.target;
      if (!target) return;
      const others = c
        .getObjects()
        .filter((o) => o !== target && o.visible !== false)
        .map((o) => {
          const r = o.getBoundingRect();
          return edgesOf(r.left, r.top, r.width, r.height);
        });
      const rect = target.getBoundingRect();
      const moving = edgesOf(rect.left, rect.top, rect.width, rect.height);
      // the tolerance is in screen pixels, so it must not stretch with zoom
      const { dx, dy, next } = (() => {
        const r = computeSnap(moving, others, {
          width: useEditorStore.getState().platform.width,
          height: useEditorStore.getState().platform.height,
        }, SNAP_THRESHOLD_PX / c.getZoom());
        return { ...r, next: r.guides };
      })();
      guides = next;
      if (dx || dy) {
        target.set({ left: (target.left ?? 0) + dx, top: (target.top ?? 0) + dy });
        target.setCoords();
      }
    });

    const clearGuides = () => {
      guides = [];
      c.requestRenderAll();
    };
    c.on('object:modified', clearGuides);
    c.on('mouse:up', clearGuides);

    c.on('after:render', () => {
      if (!guides.length) return;
      const ctx = c.getSelectionContext();
      const zoom = c.getZoom();
      ctx.save();
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      for (const g of guides) {
        ctx.beginPath();
        if (g.axis === 'x') {
          ctx.moveTo(g.at * zoom, 0);
          ctx.lineTo(g.at * zoom, c.getHeight());
        } else {
          ctx.moveTo(0, g.at * zoom);
          ctx.lineTo(c.getWidth(), g.at * zoom);
        }
        ctx.stroke();
      }
      ctx.restore();
    });

    fabricRef.current = c;
    prevPlatformRef.current = p;
    wireStudioIds(c);
    setCanvasReady(true);

    // The store outlives the editor, so without this a freshly opened Studio
    // started with Undo enabled and would restore the PREVIOUS session's canvas
    // — possibly another organisation's design.
    useEditorStore.getState().resetHistory();

    const saveState = () => {
      // Bulk loads (templates, AI designs, carousel slides) pause history and
      // commit once at the end — see withHistoryPaused.
      if (isRestoringRef.current || isHistoryPaused(c)) return;
      pushHistory(JSON.stringify(c.toJSON()));
    };
    saveStateRef.current = saveState;
    saveState();

    HISTORY_EVENTS.forEach((evt) => c.on(evt, saveState));

    const snapshotDraft = () => {
      if (isRestoringRef.current) return;
      // The design has been exported or saved: re-writing it here would bring
      // it back as a "restored draft" the next time Studio opens, long after
      // the user considered it finished.
      if (draftDoneRef.current) return;
      if (c.getObjects().length) hadContentRef.current = true;
      if (!c.getObjects().length) {
        // Emptying a canvas that HELD something is deliberate, so drop the
        // draft. An editor that never held anything (a second tab, say) must
        // leave the stored draft alone — otherwise simply opening Studio in
        // another tab wiped the design being worked on in the first.
        if (hadContentRef.current) clearDraft(orgIdRef.current);
        return;
      }
      writeDraft(orgIdRef.current, {
        canvasJson: JSON.stringify(c.toJSON()),
        platformKey: useEditorStore.getState().platform.key,
        savedAt: Date.now(),
      });
    };
    const autosave = window.setInterval(snapshotDraft, 30_000);
    // React cleanup never runs on a browser refresh/close — pagehide is the
    // only chance to snapshot there.
    window.addEventListener('pagehide', snapshotDraft);

    return () => {
      window.clearInterval(autosave);
      window.removeEventListener('pagehide', snapshotDraft);
      // Unmount fires on modal close and on the Graphics↔Video tab switch —
      // snapshot one last time so neither silently loses the design.
      snapshotDraft();
      HISTORY_EVENTS.forEach((evt) => c.off(evt, saveState));
      c.dispose();
      fabricRef.current = null;
      saveStateRef.current = null;
      setCanvasReady(false);
      useCarouselStore.getState().exitCarouselMode();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = fabricRef.current;
    if (!c) return;
    if (prevPlatformRef.current.key === platform.key) return;

    const prev = prevPlatformRef.current;
    const next = platform;

    isRestoringRef.current = true;
    c.getObjects().forEach((obj) =>
      repositionObjectFromTo(obj, prev.width, prev.height, next.width, next.height)
    );

    const newScale = getScale(next);
    c.setDimensions({ width: next.width * newScale, height: next.height * newScale });
    c.setZoom(newScale);
    c.renderAll();

    prevPlatformRef.current = next;
    isRestoringRef.current = false;

    saveStateRef.current?.();
  }, [platform, getScale]);

  /** Resize the drawing surface to a scale and tell the canvas about it. */
  const applyScale = useCallback((scale: number) => {
    const c = fabricRef.current;
    if (!c) return;
    const p = useEditorStore.getState().platform;
    c.setDimensions({ width: p.width * scale, height: p.height * scale });
    c.setZoom(scale);
    c.requestRenderAll();
    setZoomLabel(scale);
  }, []);

  const refit = useCallback(() => {
    const p = useEditorStore.getState().platform;
    applyScale(manualZoomRef.current ?? fitScale(p));
  }, [applyScale, fitScale]);

  const zoomTo = useCallback(
    (next: number | null) => {
      manualZoomRef.current =
        next === null ? null : Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      setManualZoom(manualZoomRef.current);
      refit();
    },
    [refit]
  );

  /** The canvas used to be a fixed 560px tall whatever the window was doing:
   *  an Instagram story rendered 315px wide, and on a big screen a quarter of
   *  the area sat empty. Measure the space instead, and re-fit when it or the
   *  format changes - unless the user has picked their own zoom. */
  useEffect(() => {
    const host = viewportRef.current;
    if (!host || !canvasReady) return;
    const measure = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      viewportSizeRef.current = { width, height };
      if (manualZoomRef.current === null) refit();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, [canvasReady, refit]);

  /** Ctrl/Cmd+wheel zooms around the pointer, like every other canvas tool.
   *  The artboard is a real DOM element inside a scrolling box, so keeping the
   *  point under the cursor is a scroll adjustment rather than a matrix. */
  useEffect(() => {
    const host = viewportRef.current;
    if (!host || !canvasReady) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const c = fabricRef.current;
      if (!c) return;
      const before = c.getZoom();
      const next = Math.min(
        MAX_ZOOM,
        Math.max(MIN_ZOOM, before * (1 - e.deltaY / 400))
      );
      if (next === before) return;
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left + host.scrollLeft;
      const py = e.clientY - rect.top + host.scrollTop;
      manualZoomRef.current = next;
      setManualZoom(next);
      applyScale(next);
      const ratio = next / before;
      host.scrollLeft = px * ratio - (e.clientX - rect.left);
      host.scrollTop = py * ratio - (e.clientY - rect.top);
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, [canvasReady, applyScale]);

  const restoreState = useCallback((json: string | null): Promise<void> => {
    if (!json || !fabricRef.current || !saveStateRef.current)
      return Promise.resolve();
    const c = fabricRef.current;
    const handler = saveStateRef.current;

    isRestoringRef.current = true;
    HISTORY_EVENTS.forEach((evt) => c.off(evt, handler));

    return c
      .loadFromJSON(json)
      .then(() => {
        c.renderAll();
        useEditorStore.getState().setBgColor(c.backgroundColor as string || '#1a1a2e');
      })
      .finally(() => {
        isRestoringRef.current = false;
        HISTORY_EVENTS.forEach((evt) => c.on(evt, handler));
      });
  }, []);

  useEffect(() => {
    if (!loadMediaId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const data = await (await fetch(`/media/${loadMediaId}`)).json();
        if (cancelled || !fabricRef.current) return;
        if (data?.canvasJson) {
          restoreState(data.canvasJson);
          return;
        }
        // A branded draft the agent produced server-side: rebuild an editable
        // canvas from its design spec (rather than loading the flat PNG), so
        // the user can keep editing headline / colours / layout in Studio.
        if (data?.designSpec && isPostDesignSpec(data.designSpec)) {
          await withHistoryPaused(fabricRef.current, () =>
            renderDesignSpec(
              fabricRef.current!,
              data.designSpec as PostDesignSpec,
              useEditorStore.getState().platform
            )
          );
          return;
        }
        if (data?.path) {
          // `path` is already an absolute CDN URL (the S3 storage returns one),
          // so prefixing the static directory — which on production IS that CDN
          // — produced "https://cdn…https://cdn…/x.jpg" and every "Edit design"
          // on a plain uploaded image failed to load.
          const url = data.path;
          const img = await fabric.Image.fromURL(url, { crossOrigin: 'anonymous' });
          const c = fabricRef.current;
          const w = c.getWidth() / c.getZoom();
          const h = c.getHeight() / c.getZoom();
          const scale = Math.min(w / (img.width || 1), h / (img.height || 1));
          img.set({
            left: w / 2,
            top: h / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            selectable: true,
          });
          c.add(img);
          c.renderAll();
          saveStateRef.current?.();
        }
      } catch {
        toaster.show(
          t('load_media_failed', 'Failed to load media for editing.'),
          'warning'
        );
      }
    };
    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadMediaId]);

  useEffect(() => {
    return useCarouselStore.subscribe((state, prev) => {
      if (state.pendingSlideSwitch === null) return;
      if (state.pendingSlideSwitch === prev.pendingSlideSwitch) return;
      const c = fabricRef.current;
      if (!c) return;
      const targetIndex = state.pendingSlideSwitch;
      const targetSlide = state.slides[targetIndex];
      const currentJson = JSON.stringify(c.toJSON());
      useCarouselStore.getState().commitSlideSwitch(currentJson);
      if (targetSlide?.canvasJson) {
        restoreState(targetSlide.canvasJson);
      } else {
        const handler = saveStateRef.current;
        isRestoringRef.current = true;
        if (handler) HISTORY_EVENTS.forEach((evt) => c.off(evt, handler));
        c.clear();
        c.backgroundColor = useEditorStore.getState().bgColor;
        c.renderAll();
        isRestoringRef.current = false;
        if (handler) HISTORY_EVENTS.forEach((evt) => c.on(evt, handler));
      }
    });
  }, [restoreState]);

  // Auto-restore the last unsaved draft as soon as the canvas exists — coming
  // back to Studio (from /media, the Video tab, a refresh…) should show the
  // design where you left it, not an empty canvas behind a "Restore?" banner.
  useEffect(() => {
    const c = fabricRef.current;
    if (!canvasReady || loadMediaId || !c) return;
    const draft = readDraft(orgIdRef.current);
    // Never clobber content that is already on the canvas (e.g. a media item
    // loaded by another path before this effect ran).
    if (!draft || c.getObjects().length > 0) return;

    const target = PLATFORM_SIZES.find((p) => p.key === draft.platformKey);
    if (target && target.key !== prevPlatformRef.current.key) {
      // Resize the canvas by hand and pre-sync prevPlatformRef so the
      // platform-change effect doesn't reposition layers that are already in
      // the draft's coordinate space.
      prevPlatformRef.current = target;
      setPlatform(target);
      const scale = getScale(target);
      c.setDimensions({
        width: target.width * scale,
        height: target.height * scale,
      });
      c.setZoom(scale);
    }
    setRestoringDraft(true);
    // Push the restored state into history, otherwise the first undo after a
    // restore would jump back to the initial empty canvas with no way forward.
    restoreState(draft.canvasJson)
      .then(() => saveStateRef.current?.())
      .finally(() => setRestoringDraft(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasReady]);

  const handleUndo = useCallback(() => {
    restoreState(useEditorStore.getState().undo());
  }, [restoreState]);

  const handleRedo = useCallback(() => {
    restoreState(useEditorStore.getState().redo());
  }, [restoreState]);

  const renderSlideToBlob = useCallback(
    async (canvasJson: string, width: number, height: number): Promise<Blob> => {
      const tempEl = document.createElement('canvas');
      tempEl.width = width;
      tempEl.height = height;
      const c = new fabric.StaticCanvas(tempEl, {
        width,
        height,
        backgroundColor: '#1a1a2e',
      });
      try {
        await c.loadFromJSON(canvasJson);
        c.renderAll();
        // JPEG, not PNG: photo backgrounds make PNGs several MB and the upload
        // dominates export time. The canvas is always opaque, platforms
        // recompress anyway — only "Download PNG" keeps the lossless format.
        const dataUrl = c.toDataURL({ format: 'jpeg', quality: 0.92, multiplier: 1 });
        return await (await window.fetch(dataUrl)).blob();
      } finally {
        c.dispose();
      }
    },
    []
  );

  // In the composer the export lands in the open post; in standalone /studio
  // there is no post to attach to, so carry the saved media into a fresh post
  // on /launches (NewPost picks up the query param and opens the post modal).
  const finishExport = useCallback(
    (uploaded: { id: string; path: string }[]) => {
      // The design is safely in the library/post now — stop nagging about it.
      // The flag matters as much as the clear: unmount snapshots the canvas one
      // last time, and without it the just-posted design was written straight
      // back and offered as a "restored draft" on the next visit.
      draftDoneRef.current = true;
      clearDraft(orgIdRef.current);
      if (mode === 'studio') {
        router.push(
          `/launches?newPostMedia=${encodeURIComponent(
            JSON.stringify(uploaded)
          )}`
        );
        return;
      }
      setMedia(uploaded);
      closeModal();
    },
    [mode, router, setMedia, closeModal]
  );

  const handleExport = useCallback(async () => {
    if (!fabricRef.current) return;
    setExporting(true);

    try {
      const carouselState = useCarouselStore.getState();
      const isCarousel = carouselState.isCarouselMode && carouselState.slides.length > 1;

      if (isCarousel) {
        const currentJson = JSON.stringify(fabricRef.current.toJSON());
        const slides = carouselState.slides.map((s, i) =>
          i === carouselState.currentSlideIndex ? { ...s, canvasJson: currentJson } : s
        );

        const uploaded: { id: string; path: string }[] = [];
        for (let i = 0; i < slides.length; i += 1) {
          const slide = slides[i];
          if (!slide.canvasJson) continue;
          const blob = await renderSlideToBlob(slide.canvasJson, platform.width, platform.height);
          const formData = new FormData();
          formData.append('file', blob, `slide-${i + 1}.jpg`);
          const data = await (
            await fetch('/media/upload-simple', {
              method: 'POST',
              body: formData,
            })
          ).json();
          await fetch(`/media/${data.id}/canvas`, {
            method: 'PUT',
            body: JSON.stringify({ canvasJson: slide.canvasJson }),
          });
          uploaded.push({ id: data.id, path: data.path });
        }

        useCarouselStore.getState().exitCarouselMode();
        finishExport(uploaded);
        return;
      }

      const scale = 1 / fabricRef.current.getZoom();
      // JPEG for the same reason as renderSlideToBlob — upload size dominates.
      const dataUrl = fabricRef.current.toDataURL({
        format: 'jpeg',
        quality: 0.92,
        multiplier: scale,
      });

      const blob = await (await window.fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.append('file', blob, 'design.jpg');

      const data = await (
        await fetch('/media/upload-simple', {
          method: 'POST',
          body: formData,
        })
      ).json();

      const canvasJson = JSON.stringify(fabricRef.current.toJSON());
      await fetch(`/media/${data.id}/canvas`, {
        method: 'PUT',
        body: JSON.stringify({ canvasJson }),
      });

      finishExport([{ id: data.id, path: data.path }]);
    } catch (err) {
      toaster.show(t('export_failed', 'Export failed. Please try again.'), 'warning');
    } finally {
      setExporting(false);
    }
  }, [fetch, finishExport, toaster, t, platform.width, platform.height, renderSlideToBlob]);

  const handleDownload = useCallback(() => {
    if (!fabricRef.current) return;
    const scale = 1 / fabricRef.current.getZoom();
    const dataUrl = fabricRef.current.toDataURL({
      format: 'png',
      quality: 1,
      multiplier: scale,
    });
    const link = document.createElement('a');
    link.download = `postra-design-${Date.now()}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  // Save the design into the media library (so it's reusable in any post)
  // WITHOUT attaching to a post or closing — this is the "get it out" action
  // in standalone /studio, where setMedia/closeModal are no-ops and the only
  // alternative was Download PNG (→ laptop, not the app). With asTemplate the
  // same Media row is flagged as a reusable org template ("Your templates"
  // section in the Templates panel).
  const saveDesignToLibrary = useCallback(
    async (asTemplate: boolean) => {
      if (!fabricRef.current) return;
      const scale = 1 / fabricRef.current.getZoom();
      // JPEG for the same reason as renderSlideToBlob — upload size dominates.
      const dataUrl = fabricRef.current.toDataURL({
        format: 'jpeg',
        quality: 0.92,
        multiplier: scale,
      });
      const blob = await (await window.fetch(dataUrl)).blob();
      const formData = new FormData();
      formData.append('file', blob, asTemplate ? 'template.jpg' : 'design.jpg');
      const data = await (
        await fetch('/media/upload-simple', { method: 'POST', body: formData })
      ).json();
      const canvasJson = JSON.stringify(fabricRef.current.toJSON());
      await fetch(`/media/${data.id}/canvas`, {
        method: 'PUT',
        body: JSON.stringify({ canvasJson }),
      });
      if (asTemplate) {
        await fetch(`/media/${data.id}/template`, {
          method: 'PUT',
          body: JSON.stringify({ isTemplate: true }),
        });
      }
      draftDoneRef.current = true;
      clearDraft(orgIdRef.current);
    },
    [fetch]
  );

  const handleSaveToLibrary = useCallback(async () => {
    if (!fabricRef.current || savingToLibrary) return;
    setSavingToLibrary(true);
    try {
      await saveDesignToLibrary(false);
      toaster.show(
        t(
          'saved_to_library',
          'Saved to media library — you can use it in any post.'
        ),
        'success'
      );
    } catch {
      toaster.show(
        t('save_library_failed', 'Failed to save to library.'),
        'warning'
      );
    } finally {
      setSavingToLibrary(false);
    }
  }, [saveDesignToLibrary, toaster, t, savingToLibrary]);

  const handleSaveAsTemplate = useCallback(async () => {
    if (!fabricRef.current || savingTemplate) return;
    if (!fabricRef.current.getObjects().length) {
      toaster.show(
        t('template_save_empty', 'The canvas is empty — design something first.'),
        'warning'
      );
      return;
    }
    setSavingTemplate(true);
    try {
      await saveDesignToLibrary(true);
      // Jump to the Templates panel so the fresh template is visible in
      // "Your templates" right away — a toast alone left users hunting for
      // where the design went.
      setTool('templates');
      toaster.show(
        t(
          'template_saved',
          'Saved as your template — find it in the Templates panel.'
        ),
        'success'
      );
    } catch {
      toaster.show(
        t('template_save_failed', 'Failed to save the template.'),
        'warning'
      );
    } finally {
      setSavingTemplate(false);
    }
  }, [saveDesignToLibrary, toaster, t, savingTemplate, setTool]);

  const handleDelete = useCallback(() => {
    if (!fabricRef.current) return;
    const active = fabricRef.current.getActiveObjects();
    if (!active.length) {
      toaster.show(
        t('delete_no_selection', 'Select an object on the canvas first'),
        'warning'
      );
      return;
    }
    active.forEach((obj) => fabricRef.current!.remove(obj));
    fabricRef.current.discardActiveObject();
    fabricRef.current.renderAll();
  }, [toaster, t]);

  useEffect(() => {
    // Typing in a panel field — an AI prompt, a stock search, a hex value — or
    // editing text on the canvas is not "editing the design": the browser's own
    // undo belongs to the caret, and Delete belongs to the characters.
    const isTypingTarget = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
        return true;
      }
      const active = fabricRef.current?.getActiveObject() as
        | { isEditing?: boolean }
        | undefined;
      return !!active?.isEditing;
    };

    const onKey = (e: KeyboardEvent) => {
      // The editor stays mounted (hidden) while the Video tab is open — its
      // global shortcuts must not fire at an invisible canvas. One of our own
      // modals (Welcome, All formats) owns the keyboard for the same reason;
      // the search is scoped to this editor so the composer's modal, which
      // hosts Studio, doesn't count as "on top".
      if (!canvasRef.current?.offsetParent) return;
      if (rootRef.current?.querySelector('[role="dialog"]')) return;
      if (isTypingTarget(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        handleDelete();
      }
      // Shift turns 'z' into 'Z', so the redo branch never ran and the tooltip
      // promising Ctrl+Shift+Z was wrong. Ctrl+Y is the other common binding.
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
      if ((e.metaKey || e.ctrlKey) && key === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleDelete, handleUndo, handleRedo]);

  return (
    <div
      ref={rootRef}
      className="studio-root dark flex flex-col h-full min-h-0 bg-white/[0.03] rounded-lg overflow-hidden"
    >
      <div className="flex flex-1 min-h-0">
        <EditorToolbar canvas={fabricRef} />

        {/* min-w-0 keeps the 1080px canvas from expanding this column past the
            viewport (it scrolls inside overflow-auto instead) — without it the
            right side of the action bar ("Use in post") lands off-screen. */}
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          {restoringDraft && (
            <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-forth/10 border-b border-forth/30 text-xs text-textColor">
              <span>
                ⏳{' '}
                {t(
                  'studio_draft_restoring',
                  'Restoring your last design…'
                )}
              </span>
            </div>
          )}
          <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-newBorder">
            <div className="flex gap-2">
              <button
                onClick={handleUndo}
                disabled={!canUndo}
                className="h-8 px-3 text-sm rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30 transition-colors"
                title={t('undo_tooltip', 'Undo (Ctrl+Z)')}
              >
                <StudioIcon name="undo" size={16} />
              </button>
              <button
                onClick={handleRedo}
                disabled={!canRedo}
                className="h-8 px-3 text-sm rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30 transition-colors"
                title={t('redo_tooltip', 'Redo (Ctrl+Shift+Z)')}
              >
                <StudioIcon name="redo" size={16} />
              </button>
              <button
                onClick={handleDelete}
                className="h-8 px-3 text-sm rounded bg-newColColor text-textColor hover:bg-red-500 hover:text-white transition-colors"
                title={t('delete_tooltip', 'Delete selected object (Delete)')}
              >
                <StudioIcon name="delete" size={16} />
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleSaveToLibrary}
                disabled={savingToLibrary}
                className="px-3 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                title={t('save_to_library_hint', 'Save to media library — use it in any post')}
              >
                <StudioIcon name="save" size={15} />
                {savingToLibrary ? t('saving', 'Saving…') : t('save_to_library_btn', 'Save to library')}
              </button>
              <button
                onClick={handleSaveAsTemplate}
                disabled={savingTemplate}
                className="px-3 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors disabled:opacity-50"
                title={t('template_save_hint', 'Save this design as a reusable template for your team')}
              >
                <StudioIcon name="saveTemplate" size={15} />
                {savingTemplate ? t('saving', 'Saving…') : t('template_save_btn', 'Save as template')}
              </button>
              <button
                onClick={handleDownload}
                className="px-3 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors"
                title={t('download_png_hint', 'Download the graphic as a PNG file')}
              >
                <StudioIcon name="download" size={15} />
                {t('download_png', 'Download PNG')}
              </button>
              <button
                onClick={() => setMultiFormatOpen(true)}
                className="px-3 py-1 text-xs rounded bg-newColColor text-textColor hover:bg-white/[0.08] transition-colors"
                title={t('multi_format_hint', 'Generate 7 variants for all platforms')}
              >
                <StudioIcon name="formats" size={15} />
                {t('multi_format_button', 'All formats')}
              </button>
              <Button
                loading={exporting}
                onClick={handleExport}
                className="!h-[32px] !text-xs"
              >
                {carouselSlideCount > 1
                  ? t('use_carousel_in_post', 'Export {n} slides').replace(
                      '{n}',
                      String(carouselSlideCount)
                    )
                  : t('use_in_post', 'Use in post')}
              </Button>
            </div>
          </div>

          <div
            ref={viewportRef}
            className="flex-1 min-h-0 flex items-center justify-center bg-black/30 overflow-auto p-4"
          >
            <div className="shadow-2xl rounded-sm shrink-0">
              <canvas ref={canvasRef} />
            </div>
          </div>

          <div className="shrink-0 flex items-center justify-end gap-1 px-4 py-1.5 border-t border-newBorder">
            <button
              onClick={() => zoomTo((manualZoomRef.current ?? zoomLabel) / 1.2)}
              className="h-7 w-7 rounded text-textColor/70 hover:bg-white/[0.08] hover:text-textColor transition-colors"
              title={t('zoom_out', 'Zoom out')}
              aria-label={t('zoom_out', 'Zoom out')}
            >
              −
            </button>
            <span className="min-w-[46px] text-center text-[11px] tabular-nums text-textColor/70">
              {Math.round(zoomLabel * 100)}%
            </span>
            <button
              onClick={() => zoomTo((manualZoomRef.current ?? zoomLabel) * 1.2)}
              className="h-7 w-7 rounded text-textColor/70 hover:bg-white/[0.08] hover:text-textColor transition-colors"
              title={t('zoom_in', 'Zoom in')}
              aria-label={t('zoom_in', 'Zoom in')}
            >
              +
            </button>
            <button
              onClick={() => zoomTo(null)}
              className={clsx(
                'h-7 px-2 rounded text-[11px] transition-colors',
                manualZoom === null
                  ? 'text-textColor/70'
                  : 'text-textColor hover:bg-white/[0.08]'
              )}
              title={t('zoom_fit_hint', 'Fit the design to the window')}
            >
              {t('zoom_fit', 'Fit')}
            </button>
            <button
              onClick={() => zoomTo(1)}
              className="h-7 px-2 rounded text-[11px] text-textColor/70 hover:bg-white/[0.08] hover:text-textColor transition-colors"
              title={t('zoom_100_hint', 'Show the design at its real size')}
            >
              100%
            </button>
          </div>

          <div className="shrink-0">
            <CarouselStrip fabricRef={fabricRef} />
          </div>

          <div className="shrink-0">
            <FormatBar />
          </div>
        </div>
      </div>

      {multiFormatOpen && (
        <Suspense fallback={null}>
          <MultiFormatModal
            canvasRef={fabricRef}
            srcWidth={platform.width}
            srcHeight={platform.height}
            mode={mode}
            setMedia={setMedia}
            onClose={() => setMultiFormatOpen(false)}
            closeParent={closeModal}
          />
        </Suspense>
      )}

      <WelcomeModal />
    </div>
  );
};

export default PostDesignEditor;
export { PostDesignEditor };
