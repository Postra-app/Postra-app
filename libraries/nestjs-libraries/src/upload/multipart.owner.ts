import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// A multipart upload is driven by the browser through several calls, each
// carrying the `key` and `uploadId` the first call returned. Nothing tied them
// to the organisation that started the upload: any signed-in account holding
// a leaked pair could list, sign parts into, abort or complete it, and a
// completed upload was saved to the caller's library. The first
// call records the owner; every later one must come from it.
const TTL_SECONDS = 24 * 60 * 60;
const ownerKey = (uploadId: string) => `multipart-owner:${uploadId}`;

export const recordUploadOwner = async (
  organizationId: string,
  uploadId: string,
  key: string
) => {
  await ioRedis.set(
    ownerKey(uploadId),
    `${organizationId}:${key}`,
    'EX',
    TTL_SECONDS
  );
};

export const ownsUpload = async (
  organizationId: string,
  uploadId: unknown,
  key: unknown
) => {
  if (typeof uploadId !== 'string' || typeof key !== 'string' || !uploadId) {
    return false;
  }
  return (await ioRedis.get(ownerKey(uploadId))) === `${organizationId}:${key}`;
};

export const forgetUpload = async (uploadId: string) => {
  await ioRedis.del(ownerKey(uploadId)).catch(() => undefined);
};

// Where each step carries the pair: prepare-upload-parts nests it in partData.
export const uploadPairOf = (endpoint: string, body: any) => {
  const source = endpoint === 'prepare-upload-parts' ? body?.partData : body;
  return { uploadId: source?.uploadId, key: source?.key };
};
