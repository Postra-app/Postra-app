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
// rule.
//
// One Lua script, so two parts signed at once cannot both see the old sum.
// A part signed again keeps the larger of its sizes: the URL signed first is
// still valid for an hour, so signing it again smaller must not free budget.
const RESERVE_PART = `
local declared = tonumber(redis.call('GET', KEYS[1]))
if not declared then return 0 end
local part = ARGV[1]
local bytes = tonumber(ARGV[2])
local keep = math.max(tonumber(redis.call('HGET', KEYS[2], part) or '0'), bytes)
local all = redis.call('HGETALL', KEYS[2])
local others = 0
for i = 1, #all, 2 do
  if all[i] ~= part then others = others + tonumber(all[i + 1]) end
end
if others + keep > declared then return 0 end
redis.call('HSET', KEYS[2], part, keep)
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1
`;

// Without a Redis server (local runs) ioRedis is an in-process stand-in
// with no hashes or scripts; the same rule then runs on a map in this
// process, which is all that stand-in shares anyway.
const localParts = new Map<string, Map<string, number>>();
const reserveLocally = async (uploadId: string, part: string, bytes: number) => {
  const declared = Number(await ioRedis.get(sizeKey(uploadId)));
  if (!declared) return false;
  const parts = localParts.get(uploadId) || new Map<string, number>();
  const keep = Math.max(parts.get(part) || 0, bytes);
  let others = 0;
  parts.forEach((v, k) => {
    if (k !== part) others += v;
  });
  if (others + keep > declared) return false;
  parts.set(part, keep);
  localParts.set(uploadId, parts);
  return true;
};

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
  const redis = ioRedis as unknown as {
    eval?: (...args: (string | number)[]) => Promise<unknown>;
  };
  if (typeof redis.eval !== 'function') {
    return reserveLocally(uploadId, String(part), bytes);
  }
  const ok = await redis.eval(
    RESERVE_PART,
    2,
    sizeKey(uploadId),
    partsKey(uploadId),
    String(part),
    String(bytes),
    String(TTL_SECONDS)
  );
  return Number(ok) === 1;
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
  localParts.delete(uploadId);
  await ioRedis
    .del(ownerKey(uploadId), sizeKey(uploadId), partsKey(uploadId))
    .catch(() => undefined);
};

// Where each step carries the pair: prepare-upload-parts nests it in partData.
export const uploadPairOf = (endpoint: string, body: any) => {
  const source = endpoint === 'prepare-upload-parts' ? body?.partData : body;
  return { uploadId: source?.uploadId, key: source?.key };
};
