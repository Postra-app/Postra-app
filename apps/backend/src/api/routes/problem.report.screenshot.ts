import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// The "Report a problem" screenshot, carried as a data URL. Only a real PNG or
// JPEG up to 5 MB is kept: the header must match the bytes, not just the label.
const MAX_BYTES = 5 * 1024 * 1024;
const LINK_SECONDS = 7 * 24 * 3600; // the longest a presigned link may live

export const decodeScreenshot = (dataUrl?: string) => {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buffer = Buffer.from(m[2], 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) return null;
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if ((m[1] === 'png' && !png) || (m[1] === 'jpeg' && !jpeg)) return null;
  return { buffer, type: `image/${m[1]}`, ext: m[1] === 'png' ? 'png' : 'jpg' };
};

// Stored under an unguessable key and handed to the team as a 7-day link; the
// original stays in Sentry. Screenshots can show customer data, so no public
// link is put in the mail.
export const storeScreenshot = async (shot: NonNullable<ReturnType<typeof decodeScreenshot>>) => {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return undefined;
  const client = new S3Client({ region: process.env.S3_REGION || 'eu-west-2' });
  const Key = `problem-reports/${randomUUID()}.${shot.ext}`;
  await client.send(new PutObjectCommand({ Bucket: bucket, Key, Body: shot.buffer, ContentType: shot.type }));
  return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key }), { expiresIn: LINK_SECONDS });
};
