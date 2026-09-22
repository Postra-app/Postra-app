import XHRUpload from '@uppy/xhr-upload';
import AwsS3Multipart from '@uppy/aws-s3';
import sha256 from 'sha256';
import Transloadit from '@uppy/transloadit';
const fetchUploadApiEndpoint = async (
  fetch: any,
  endpoint: string,
  data: any
) => {
  const res = await fetch(`/media/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  return res.json();
};

// Define the factory to return appropriate Uppy configuration
export const getUppyUploadPlugin = (
  provider: string,
  fetch: any,
  backendUrl: string,
  transloadit: string[] = []
) => {
  switch (provider) {
    case 'transloadit':
      return {
        plugin: Transloadit,
        options: {
          waitForEncoding: true,
          alwaysRunAssembly: true,
          assemblyOptions: {
            params: {
              auth: { key: transloadit[0] },
              template_id: transloadit[1],
            },
          },
        },
      };
    case 'cloudflare':
    // s3 shares the same chunked, direct-to-bucket multipart path (presigned
    // part URLs) — see s3.uploader.ts on the backend. This bypasses nginx's
    // body-size cap and avoids buffering the whole file in backend memory.
    case 's3':
      return {
        plugin: AwsS3Multipart,
        options: {
          shouldUseMultipart: (file: any) => true,
          // One 503 from S3 on part 7 of a 192 MB file aborted the whole upload
          // (E2E-06-11): the default retries give up after about nine seconds,
          // and S3 asks callers to slow down for longer than that.
          retryDelays: [0, 1000, 3000, 5000, 10000, 20000, 30000],
          endpoint: '',
          createMultipartUpload: async (file: any) => {
            let fileHash = '';
            const contentType = file.type;

            // Skip hash calculation for files larger than 100MB to avoid "Invalid array length" error
            if (file.size <= 100 * 1024 * 1024) {
              try {
                const arrayBuffer = await new Response(file.data).arrayBuffer();
                fileHash = sha256(Buffer.from(arrayBuffer));
              } catch (error) {
                console.warn(
                  'Failed to calculate file hash, proceeding without hash:',
                  error
                );
                fileHash = '';
              }
            }

            return fetchUploadApiEndpoint(fetch, 'create-multipart-upload', {
              file,
              fileHash,
              contentType,
            });
          },
          listParts: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'list-parts', {
              file,
              ...props,
            }),
          signPart: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'sign-part', {
              file,
              ...props,
            }),
          abortMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'abort-multipart-upload', {
              file,
              ...props,
            }),
          completeMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'complete-multipart-upload', {
              file,
              ...props,
            }),
        },
      };
    case 'local':
      return {
        plugin: XHRUpload,
        options: {
          endpoint: `${backendUrl}/media/upload-server`,
          withCredentials: true,
        },
      };

    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};
