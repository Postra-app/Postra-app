import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// The "Report a problem" screenshot, carried as a data URL. Only a real PNG or
// JPEG up to 5 MB is kept: the header must match the bytes, not just the label.
const MAX_BYTES = 5 * 1024 * 1024;
// A presigned link lives only as long as the credentials that signed it. On
// the server those are the instance role's, which last a few hours, so the
// mail cannot carry a signed link: it links to /admin/problem-reports/<file>,
// which signs a fresh short one for a logged-in administrator on every click.
const LINK_SECONDS = 300;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$/;

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

const client = () => new S3Client({ region: process.env.S3_REGION || 'eu-west-2' });

// Stored under an unguessable key that the CDN refuses to serve and S3 drops
// after 30 days (terraform modules/cdn); the original stays in Sentry.
// Returns the file name, not a link.
export const storeScreenshot = async (shot: NonNullable<ReturnType<typeof decodeScreenshot>>) => {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return undefined;
  const file = `${randomUUID()}.${shot.ext}`;
  await client().send(
    new PutObjectCommand({ Bucket: bucket, Key: `problem-reports/${file}`, Body: shot.buffer, ContentType: shot.type })
  );
  return file;
};

export const screenshotLink = (file: string) =>
  `${process.env.NEXT_PUBLIC_BACKEND_URL}/admin/problem-reports/${file}`;

export const isScreenshotFile = (file: string) => FILE.test(file);

export const signScreenshot = (file: string) =>
  getSignedUrl(
    client(),
    new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: `problem-reports/${file}` }),
    { expiresIn: LINK_SECONDS }
  );
