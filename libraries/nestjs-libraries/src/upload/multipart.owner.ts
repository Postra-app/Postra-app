import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// A multipart upload is driven by the browser through several calls, each
// carrying the `key` and `uploadId` the first call returned. Nothing tied them
// to the organisation that started the upload: any signed-in account holding
// a leaked pair could list, sign parts into, abort or complete it, and a
// completed upload was saved to the caller's library. The first
// call records the owner; every later one must come from it.
const TTL_SECONDS = 24 * 60 * 60;
const ownerKey = (uploadId: string) => `multipart-owner:${uploadId}`;
const sizeKey = (uploadId: string) => `multipart-size:${uploadId}`;
const partsKey = (uploadId: string) => `multipart-parts:${uploadId}`;

// S3 takes up to 5 GiB per part; no client of ours sends parts near that.
export const MAX_PART_BYTES = 5 * 1024 * 1024 * 1024;

export const recordUploadOwner = async (
  organizationId: string,
  uploadId: string,
  key: string,
  // The size the client declared at the start: every part signed later must
  // fit in it (reservePart).
  declaredSize?: number
) => {
  await ioRedis.set(
    ownerKey(uploadId),
    `${organizationId}:${key}`,
    'EX',
    TTL_SECONDS
  );
  if (declaredSize && declaredSize > 0) {
    await ioRedis.set(sizeKey(uploadId), String(declaredSize), 'EX', TTL_SECONDS);
  }
};

// A part is signed for its exact length (S3 refuses any other), and only
// while the parts signed so far fit in the declared size. Without this a
// client could declare 10 MB, sign hundreds of parts and put 5 GB in each
// straight into the bucket: `complete` checks the real size, but an upload
// never completed stays stored (and paid for) until the 7-day lifecycle
// rule. A part signed again (a retry) replaces its earlier size.
export const reservePart = async (
  uploadId: string,
  partNumber: unknown,
  size: unknown
): Promise<boolean> => {
  const part = Number(partNumber);
  const bytes = Number(size);
  if (
    !Number.isInteger(part) ||
    part < 1 ||
    part > 10000 ||
    !Number.isInteger(bytes) ||
    bytes < 1 ||
    bytes > MAX_PART_BYTES
  ) {
    return false;
  }
  const declared = Number(await ioRedis.get(sizeKey(uploadId)));
  if (!declared) {
    return false;
  }
  const signed = (await ioRedis.hgetall(partsKey(uploadId))) || {};
  const others = Object.entries(signed)
    .filter(([n]) => Number(n) !== part)
    .reduce((sum, [, v]) => sum + Number(v || 0), 0);
  if (others + bytes > declared) {
    return false;
  }
  await ioRedis.hset(partsKey(uploadId), String(part), String(bytes));
  await ioRedis.expire(partsKey(uploadId), TTL_SECONDS);
  return true;
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
  await ioRedis
    .del(ownerKey(uploadId), sizeKey(uploadId), partsKey(uploadId))
    .catch(() => undefined);
};

// Where each step carries the pair: prepare-upload-parts nests it in partData.
export const uploadPairOf = (endpoint: string, body: any) => {
  const source = endpoint === 'prepare-upload-parts' ? body?.partData : body;
  return { uploadId: source?.uploadId, key: source?.key };
};
