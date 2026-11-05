import { HttpException } from '@nestjs/common';
import { planLimits } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { IUploadProvider } from '@gitroom/nestjs-libraries/upload/upload.interface';

// The plan's media storage: a media library cannot
// grow without end on a £19 plan. The limits per plan are in pricing.ts
// (`media_storage_gb`); this file holds the rules, MediaService the wiring.

export const GB = 1024 * 1024 * 1024;
export const MEDIA_STORAGE_FULL = 'MEDIA_STORAGE_FULL';

// 1.2 GB, 850 MB, 12 KB: how the limit reads to the customer.
export const formatBytes = (bytes: number): string => {
  if (bytes >= GB) return `${+(bytes / GB).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
};

// Bytes the plan allows, or null while billing is off (self-hosted, local):
// there every other plan limit is off too.
export const storageLimit = (
  tier: string | null | undefined,
  trialing: boolean,
  billingOn = !!process.env.STRIPE_PUBLISHABLE_KEY
): number | null =>
  billingOn ? planLimits(tier || 'FREE', trialing).media_storage_gb * GB : null;

// The refusal for a file that does not fit, or null when it fits. 402, as
// for every other plan limit, so the web offers the billing page; `code` lets
// the phone app say it in the customer's language.
export const storageFullError = (
  used: number,
  limit: number | null,
  incomingBytes: number
): HttpException | null => {
  if (limit === null || used + Math.max(0, incomingBytes || 0) <= limit) {
    return null;
  }
  return new HttpException(
    {
      code: MEDIA_STORAGE_FULL,
      used,
      limit,
      message: `Your media library is full: ${formatBytes(used)} of ${formatBytes(
        limit
      )} on your plan. Delete files you no longer need, or upgrade your plan for more space.`,
    },
    402
  );
};

// The size recorded for a new library file: the caller's, when it held the
// bytes, otherwise the storage's answer, otherwise 0 (counted as nothing).
export const sizeToRecord = async (
  known: number | undefined,
  storage: Pick<IUploadProvider, 'sizeOf'>,
  filePath: string
): Promise<number> => {
  if (known && known > 0) return Math.round(known);
  try {
    return (await storage.sizeOf?.(filePath)) || 0;
  } catch {
    return 0;
  }
};
