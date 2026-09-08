'use client';

import { FC, MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import * as fabric from 'fabric';
import JSZip from 'jszip';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { Button } from '@gitroom/frontend/components/ui/button';
import {
  renderAllFormats,
  dataUrlToBlob,
  FormatRender,
} from './utils/multi-format-renderer';

interface MultiFormatModalProps {
  canvasRef: MutableRefObject<fabric.Canvas | null>;
  srcWidth: number;
  srcHeight: number;
  mode: 'composer' | 'studio';
  setMedia: (params: { id: string; path: string }[]) => void;
  onClose: () => void;
  closeParent: () => void;
}

export const MultiFormatModal: FC<MultiFormatModalProps> = ({
  canvasRef,
  srcWidth,
  srcHeight,
  mode,
  setMedia,
  onClose,
  closeParent,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const [renders, setRenders] = useState<FormatRender[]>([]);
  const [renderProgress, setRenderProgress] = useState({ done: 0, total: 7 });
  const [renderError, setRenderError] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!canvasRef.current) {
        setRenderError(true);
        return;
      }
      try {
        const json = JSON.stringify(canvasRef.current.toJSON());
        const results = await renderAllFormats(
          json,
          srcWidth,
          srcHeight,
          (done, total) => {
            if (!cancelled) setRenderProgress({ done, total });
          }
        );
        if (!cancelled) setRenders(results);
      } catch {
        if (!cancelled) setRenderError(true);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [canvasRef, srcWidth, srcHeight]);

  const isRendering = renders.length === 0 && !renderError;

  const downloadDataUrl = useCallback((dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.download = filename;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, []);

  const handleDownloadOne = useCallback(
    (render: FormatRender) => {
      downloadDataUrl(
        render.dataUrl,
        `postra-${render.platform.key}-${Date.now()}.png`
      );
    },
    [downloadDataUrl]
  );

  const handleDownloadZip = useCallback(async () => {
    try {
      const zip = new JSZip();
      await Promise.all(
        renders.map(async (r) => {
          const blob = await dataUrlToBlob(r.dataUrl);
          zip.file(`${r.platform.key}.png`, blob);
        })
      );
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `postra-multiformat-${Date.now()}.zip`;
      link.href = url;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      toaster.show(
        t('multi_format_error', 'Rendering failed. Please try again.'),
        'warning'
      );
    }
  }, [renders, t, toaster]);

  const handleAddAllToPost = useCallback(async () => {
    setUploading(true);
    setUploadProgress({ done: 0, total: renders.length });
    const uploaded: { id: string; path: string }[] = [];
    try {
      for (let i = 0; i < renders.length; i += 1) {
        const r = renders[i];
        // eslint-disable-next-line no-await-in-loop
        const blob = await dataUrlToBlob(r.dataUrl);
        const formData = new FormData();
        formData.append('file', blob, `${r.platform.key}.png`);
        // eslint-disable-next-line no-await-in-loop
        const data = await (
          await fetch('/media/upload-simple', {
            method: 'POST',
            body: formData,
          })
        ).json();
        if (r.canvasJson) {
          // eslint-disable-next-line no-await-in-loop
          await fetch(`/media/${data.id}/canvas`, {
            method: 'PUT',
            body: JSON.stringify({ canvasJson: r.canvasJson }),
          });
        }
        uploaded.push({ id: data.id, path: data.path });
        setUploadProgress({ done: i + 1, total: renders.length });
      }
      setMedia(uploaded);
      onClose();
      closeParent();
    } catch {
      toaster.show(
        t('multi_format_error', 'Rendering failed. Please try again.'),
        'warning'
      );
      setUploading(false);
    }
  }, [renders, fetch, setMedia, onClose, closeParent, t, toaster]);

  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousActive = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !uploading) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      previousActive?.focus?.();
    };
  }, [onClose, uploading]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={() => !uploading && onClose()}
      role="dialog"
      aria-modal="true"
      aria-labelledby="multi-format-modal-title"
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] mx-4 bg-[rgba(15,23,42,0.92)] backdrop-blur-xl rounded-lg shadow-2xl flex flex-col overflow-hidden border border-newBorder"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-newBorder flex items-center justify-between">
          <h2
            id="multi-format-modal-title"
            className="text-lg font-semibold text-textColor"
          >
            📐 {t('multi_format_title', 'Export to all platforms')}
          </h2>
          <button
            ref={closeButtonRef}
            onClick={() => !uploading && onClose()}
            disabled={uploading}
            className="text-textColor/60 hover:text-textColor text-2xl leading-none disabled:opacity-30"
            aria-label={t('multi_format_cancel', 'Cancel')}
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {isRendering && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-12 h-12 border-4 border-newBorder border-t-textColor rounded-full animate-spin" />
              <div className="text-textColor">
                {t('multi_format_rendering', 'Rendering')} {renderProgress.done}/{renderProgress.total}…
              </div>
            </div>
          )}

          {renderError && (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <div className="text-red-400">
                {t('multi_format_error', 'Rendering failed. Please try again.')}
              </div>
            </div>
          )}

          {renders.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {renders.map((r) => (
                <div
                  key={r.platform.key}
                  className="flex flex-col bg-newColColor rounded-md overflow-hidden border border-newBorder"
                >
                  <div className="aspect-square bg-black/40 flex items-center justify-center p-2">
                    <img
                      src={r.dataUrl}
                      alt={r.platform.label}
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <div className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="text-xs text-textColor truncate" title={r.platform.label}>
                      {r.platform.label}
                    </div>
                    <button
                      onClick={() => handleDownloadOne(r)}
                      disabled={uploading}
                      className="text-xs px-2 py-1 rounded bg-forth text-textColor hover:bg-newColColor disabled:opacity-30 whitespace-nowrap"
                    >
                      ⬇ {t('multi_format_download_one', 'Download')}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {renders.length > 0 && (
          <div className="px-6 py-4 border-t border-newBorder flex items-center justify-between gap-3">
            <button
              onClick={onClose}
              disabled={uploading}
              className="text-sm px-4 py-2 rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30"
            >
              {t('multi_format_cancel', 'Cancel')}
            </button>
            <div className="flex items-center gap-3">
              {uploading && (
                <div className="text-xs text-textColor/70">
                  {t('multi_format_uploading', 'Uploading')} {uploadProgress.done}/{uploadProgress.total}…
                </div>
              )}
              <button
                onClick={handleDownloadZip}
                disabled={uploading}
                className="text-sm px-4 py-2 rounded bg-newColColor text-textColor hover:bg-white/[0.08] disabled:opacity-30"
              >
                ⬇ {t('multi_format_download_zip', 'Download all (ZIP)')}
              </button>
              {mode === 'composer' && (
                <Button
                  loading={uploading}
                  onClick={handleAddAllToPost}
                  className="!h-[36px] !text-sm"
                >
                  {t('multi_format_add_to_post', 'Add all to post')}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
