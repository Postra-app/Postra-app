import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Uppy, { BasePlugin, UploadResult, UppyFile } from '@uppy/core';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { getUppyUploadPlugin } from '@gitroom/react/helpers/uppy.upload';
import { Dashboard, FileInput, ProgressBar } from '@uppy/react';

// Uppy styles
import { useVariables } from '@gitroom/react/helpers/variable.context';
import Compressor from '@uppy/compressor';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { uniqBy } from 'lodash';

// Shrunk to 1000 px in the browser before upload (see the size check).
const COMPRESSED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export class CompressionWrapper<M = any, B = any> extends Compressor<any, any> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();

    // 1) Only images, and not GIFs. The compressor announces "Compressing
    //    images…" for every file it is handed, videos included.
    const filteredIDs = fileIDs.filter((id) => {
      const f = files[id];
      if (!f) return false;

      const type = f.type ?? '';
      const name = (f.name ?? '').toLowerCase();
      const isGif = type === 'image/gif' || name.endsWith('.gif');

      return type.startsWith('image/') && !isGif;
    });

    // 2) Let @uppy/compressor do its work (convert/resize/etc)
    return super.prepareUpload(filteredIDs);
  }
}

// Shown over the upload progress bar while a file is uploading: a big video
// picked by mistake could not be stopped (E2E-06-36).
export const UploadCancelButton = ({ uppy }: { uppy: Uppy<any, any> }) => {
  const t = useT();
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    const update = () =>
      setUploading(Object.keys(uppy.getState().currentUploads ?? {}).length > 0);
    uppy.on('state-update', update);
    update();
    return () => {
      uppy.off('state-update', update);
    };
  }, [uppy]);
  if (!uploading) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={() => uppy.cancelAll()}
      className="pointer-events-auto absolute end-[8px] top-[9px] z-[2] h-[28px] px-[12px] rounded-[6px] text-[13px] text-white bg-[rgba(10,14,26,0.9)] border border-white/20 hover:bg-white/10"
    >
      {t('cancel_upload', 'Cancel upload')}
    </button>
  );
};

/** "image/*,video/mp4" in words a person uses. */
const describeAllowed = (allowed: string) => {
  const kinds = allowed.split(',').map((t) => t.trim());
  const images = kinds.some((t) => t.startsWith('image/'));
  const videos = kinds.some((t) => t.startsWith('video/'));
  if (images && videos) return 'Upload an image or an MP4 video.';
  if (videos) return 'Upload an MP4 video.';
  if (images) return 'Upload an image (JPG, PNG, WebP or GIF).';
  return '';
};

export function useUppyUploader(props: {
  // @ts-expect-error UploadResult is generic; Uppy's types require its 2 type args
  onUploadSuccess: (result: UploadResult) => void;
  onStart: () => void;
  onEnd: () => void;
  allowedFileTypes: string;
}) {
  const setLocked = useLaunchStore((state) => state.setLocked);
  const toast = useToaster();
  const { storageProvider, backendUrl, disableImageCompression, transloadit } =
    useVariables();
  const { onUploadSuccess, allowedFileTypes } = props;
  const fetch = useFetch();
  return useMemo(() => {
    // Track file order to maintain original sequence after upload
    let fileOrderIndex = 0;

    const uppy2 = new Uppy({
      autoProceed: true,
      // No maxFileSize here: Uppy reported its own limit in MiB ("exceeds
      // maximum allowed size of 954 MB"), a number that appears nowhere else,
      // before our 1 GB message could show. The size checks below are the only
      // ones.
      locale: {
        strings: {
          // The stock string ended in a dangling "?" when S3 gave no reason.
          failedToUpload: 'Could not upload %{file}',
        },
      } as any,
    });

    // A file our own checks refuse has already been explained in a toast; the
    // generic "Upload failed" that followed contradicted it.
    let refusalShown = false;
    const refuse = (message: string) => {
      refusalShown = true;
      toast.show(message, 'warning');
    };

    // check for valid file types it can be something like this image/*,video/mp4.
    // If it's an image, I need to replace image/* with image/png, image/jpeg, image/jpeg, image/gif (separately)
    uppy2.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy2.getFiles();
        const allowedTypes = allowedFileTypes
          .split(',')
          .map((type) => type.trim());

        // Expand generic types to specific ones
        const expandedTypes = allowedTypes.flatMap((type) => {
          if (type === 'image/*') {
            return [
              'image/png',
              'image/jpeg',
              'image/jpg',
              'image/gif',
              'image/webp',
            ];
          }
          if (type === 'video/*') {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          if (type === 'video/mp4' && transloadit && transloadit.length > 0) {
            return ['video/mp4', 'video/mpeg', 'video/quicktime'];
          }
          return [type];
        });

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const fileType = file.type;

            // Check if file type is allowed
            const isAllowed = expandedTypes.some((allowedType) => {
              if (allowedType.endsWith('/*')) {
                const baseType = allowedType.replace('/*', '/');
                return fileType?.startsWith(baseType);
              }
              return fileType === allowedType;
            });

            if (!isAllowed) {
              const error = new Error(
                `File type "${fileType}" is not allowed for file "${file.name}". Allowed types: ${allowedFileTypes}`
              );
              uppy2.log(error.message, 'error');
              refuse(
                `${file.name} can't be uploaded here. ${describeAllowed(
                  allowedFileTypes
                )}`
              );
              uppy2.removeFile(file.id);
              return reject(error);
            }
          }
        }

        resolve();
      });
    });

    uppy2.addPreProcessor((fileIDs) => {
      return new Promise<void>((resolve, reject) => {
        const files = uppy2.getFiles();

        for (const file of files) {
          if (fileIDs.includes(file.id)) {
            const isImage = file.type?.startsWith('image/');
            const isVideo = file.type?.startsWith('video/');

            // JPEG, PNG and WebP are shrunk to 1000 px below before upload,
            // so 30 MB is fine for them. Anything sent as it is (a GIF, or
            // every image when compression is off) meets the server's 10 MB
            // limit, and above it came back as a 400 after the whole upload
            // (K12, 10-10).
            const shrunk =
              !disableImageCompression &&
              COMPRESSED_TYPES.includes(file.type || '');
            const maxImageSize = (shrunk ? 30 : 10) * 1024 * 1024;
            const maxVideoSize = 1000 * 1024 * 1024; // 1GB

            if (isImage && file.size > maxImageSize) {
              const error = new Error(
                `Image file "${file.name}" is too large. Maximum size allowed is ${
                  shrunk ? 30 : 10
                }MB.`
              );
              uppy2.log(error.message, 'error');
              refuse(
                shrunk
                  ? `${file.name} is too large. Images can be up to 30 MB.`
                  : file.type === 'image/gif'
                  ? `${file.name} is too large. GIFs can be up to 10 MB.`
                  : `${file.name} is too large. Images can be up to 10 MB.`
              );
              uppy2.removeFile(file.id); // Remove file from queue
              return reject(error);
            }

            if (isVideo && file.size > maxVideoSize) {
              const error = new Error(
                `Video file "${file.name}" is too large. Maximum size allowed is 1GB.`
              );
              uppy2.log(error.message, 'error');
              refuse(`${file.name} is too large. Videos can be up to 1 GB.`);
              uppy2.removeFile(file.id); // Remove file from queue
              return reject(error);
            }
          }
        }

        resolve();
      });
    });

    const { plugin, options } = getUppyUploadPlugin(
      transloadit.length > 0 ? 'transloadit' : storageProvider,
      fetch,
      backendUrl,
      transloadit
    );

    uppy2.use(plugin, options);
    if (!disableImageCompression) {
      uppy2.use(CompressionWrapper, {
        convertTypes: COMPRESSED_TYPES,
        maxWidth: 1000,
        maxHeight: 1000,
        quality: 1,
      });
    }
    // Set additional metadata when a file is added
    uppy2.on('file-added', (file) => {
      setLocked(true);
      uppy2.setFileMeta(file.id, {
        useCloudflare: storageProvider === 'cloudflare' ? 'true' : 'false', // Example of adding a custom field
        addedOrder: fileOrderIndex++, // Track original order for sorting after upload
        // Add more fields as needed
      });
    });
    uppy2.on('error', (result) => {
      // One file of a batch failed: the rest are still uploading, and
      // 'complete' reports this one with them. Resetting here dropped every
      // other file of the batch (upstream 29478ed6).
      if (Object.keys(uppy2.getState().currentUploads).length) {
        console.warn('[Postra:upload] a file failed', result);
        return;
      }
      console.error('[Postra:upload] upload failed', result);
      if (!refusalShown) {
        toast.show('Upload failed - please try again.', 'warning');
      }
      refusalShown = false;
      // clear() throws while an upload is registered and leaves the uploader
      // plugin running; cancelAll() removes the files and aborts them
      // (upstream 66d9ef75).
      uppy2.cancelAll();
      setLocked(false);
      props.onEnd();
      fileOrderIndex = 0;
    });
    uppy2.on('upload-start', () => {
      props.onStart();
    });
    // Cancel upload (E2E-06-36): cancelAll() aborts the requests (and an S3
    // multipart upload through abortMultipartUpload) but fires no 'complete',
    // so the composer would stay locked.
    uppy2.on('cancel-all', () => {
      setLocked(false);
      props.onEnd();
      fileOrderIndex = 0;
    });
    uppy2.on('complete', async (result) => {
      const failed = result.failed || [];
      // Failed files go too, or the next upload would quietly retry them.
      for (const file of [...result.successful, ...failed]) {
        uppy2.removeFile(file.id);
      }
      if (failed.length) {
        const names = failed.map((f) => f.name).filter(Boolean);
        toast.show(
          `Some files failed to upload${
            names.length ? ` (${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})` : ''
          } - please try again.`,
          'warning'
        );
      }

      props.onEnd();
      // Sort results by original add order to maintain file sequence
      const sortedSuccessful = [...result.successful].sort((a, b) => {
        const orderA = +((a.meta as any)?.addedOrder ?? 0);
        const orderB = +((b.meta as any)?.addedOrder ?? 0);
        return orderA - orderB;
      });

      // whatever happens below, never leave the composer locked
      try {
        if (!result.successful.length) {
          return;
        }
        if (storageProvider === 'local') {
          onUploadSuccess(sortedSuccessful.map((p) => p.response.body));
          return;
        }

        if (transloadit.length > 0) {
          // @ts-expect-error transloadit result is typed as {}; indexing it isn't allowed
          const allRes = result.transloadit?.[0]?.results;
          if (!allRes) {
            throw new Error('empty transloadit assembly result');
          }
          const toSave = uniqBy<{
            name: string;
            originalName: string;
            order: number;
          }>(
            // @ts-expect-error flatMap value is unknown; the callback takes any[]
            Object.values(allRes).flatMap((p: any[]) => {
              return p.flatMap((item) => ({
                name: item.url.split('/').pop(),
                originalName: item.name || '',
                order: +item.user_meta.addedOrder,
              }));
            }),
            (item) => item.name
          );

          const loadAllMedia = (
            await Promise.all(
              toSave.map(async ({ name, originalName, order }) => {
                const saveResponse = await fetch('/media/save-media', {
                  method: 'POST',
                  body: JSON.stringify({
                    name,
                    originalName,
                  }),
                });
                if (!saveResponse.ok) {
                  throw new Error(`save-media failed (${saveResponse.status})`);
                }
                return {
                  file: await saveResponse.json(),
                  order,
                };
              })
            )
          )
            .sort((a, b) => {
              return a.order - b.order;
            })
            .map((p) => p.file);

          onUploadSuccess(loadAllMedia);
          return;
        }

        onUploadSuccess(sortedSuccessful.map((p) => p.response.body.saved));
      } catch (e) {
        console.error('[Postra:upload] post-upload processing failed', e);
        toast.show(
          'Upload failed while saving the file - please try again.',
          'warning'
        );
      } finally {
        setLocked(false);
        fileOrderIndex = 0;
      }
    });
    uppy2.on('upload-success', (file, response) => {
      // Already removed (a refused or cancelled file): nothing to update, and
      // reading its progress threw (upstream c2d35f94).
      const current = uppy2.getState().files[file.id];
      if (!current) {
        return;
      }
      uppy2.setFileState(file.id, {
        progress: current.progress,
        uploadURL: response.body.Location,
        response: response,
        isPaused: false,
      });
    });
    return uppy2;
  }, []);
}
