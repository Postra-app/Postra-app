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

export class CompressionWrapper<M = any, B = any> extends Compressor<any, any> {
  override async prepareUpload(fileIDs: string[]) {
    const { files } = this.uppy.getState();

    // 1) Only images, and not GIFs. The compressor announces "Compressing
    //    images…" for every file it is handed, videos included (E2E-06-14).
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
      // ones (E2E-06-14).
      locale: {
        strings: {
          // The stock string ended in a dangling "?" when S3 gave no reason.
          failedToUpload: 'Could not upload %{file}',
        },
      } as any,
    });

    // A file our own checks refuse has already been explained in a toast; the
    // generic "Upload failed" that followed contradicted it (E2E-06-14).
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

            const maxImageSize = 30 * 1024 * 1024; // 30MB
            const maxVideoSize = 1000 * 1024 * 1024; // 1GB

            if (isImage && file.size > maxImageSize) {
              const error = new Error(
                `Image file "${file.name}" is too large. Maximum size allowed is 30MB.`
              );
              uppy2.log(error.message, 'error');
              refuse(`${file.name} is too large. Images can be up to 30 MB.`);
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
        convertTypes: ['image/jpeg', 'image/png', 'image/webp'],
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
      console.error('[Postra:upload] upload failed', result);
      if (!refusalShown) {
        toast.show('Upload failed — please try again.', 'warning');
      }
      refusalShown = false;
      uppy2.clear();
      setLocked(false);
      props.onEnd();
      fileOrderIndex = 0;
    });
    uppy2.on('upload-start', () => {
      props.onStart();
    });
    uppy2.on('complete', async (result) => {
      for (const file of [...result.successful]) {
        uppy2.removeFile(file.id);
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
          'Upload failed while saving the file — please try again.',
          'warning'
        );
      } finally {
        setLocked(false);
        fileOrderIndex = 0;
      }
    });
    uppy2.on('upload-success', (file, response) => {
      uppy2.setFileState(file.id, {
        progress: uppy2.getState().files[file.id].progress,
        uploadURL: response.body.Location,
        response: response,
        isPaused: false,
      });
    });
    return uppy2;
  }, []);
}
