import {
  UploadPartCommand,
  S3Client,
  ListPartsCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import path from 'path';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';

// Mirror of r2.uploader.ts but pointed at AWS S3 (postra-dev-media via the
// instance role) so the `s3` storage provider gets chunked, direct-to-bucket
// multipart uploads instead of pushing the whole file through nginx + multer
// memory (which capped uploads at 50 MB and risked OOM on big videos).

const logger = new Logger('S3Uploader');

const ALLOWED_EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.mp4': 'video/mp4',
};

// Size limits. The size declared at create time is only the client's word:
// S3 never sees it, and each presigned part accepts up to 5 GB, so the real
// size of the assembled object is checked again on complete (with the magic
// bytes). Generous enough for long-form video (YouTube, Reels).
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024; // 4 GB

function normalizeExtension(filename: string): string | null {
  const ext = path.extname(filename || '').toLowerCase();
  return ALLOWED_EXT_TO_MIME[ext] ? ext : null;
}

function maxBytesForMime(mime: string): number {
  return mime.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
}

const S3_BUCKET = process.env.S3_BUCKET!;
const S3_REGION = process.env.S3_REGION || 'eu-west-2';
const CDN_URL = process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY!;

const s3ClientConfig: ConstructorParameters<typeof S3Client>[0] = {
  region: S3_REGION,
};
// Static credentials for local dev; on EC2 the instance role is used
// automatically via the default credential chain.
if (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY) {
  s3ClientConfig.credentials = {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  };
}

const S3 = new S3Client(s3ClientConfig);

// Dated key layout, identical to s3.storage.ts so removeFile (which parses the
// URL pathname into a key) keeps working for multipart-uploaded media too.
function buildKey(extension: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}/${m}/${d}/${makeId(10)}${extension}`;
}

export default async function handleS3Upload(
  endpoint: string,
  req: Request,
  res: Response
) {
  switch (endpoint) {
    case 'create-multipart-upload':
      return createMultipartUpload(req, res);
    case 'prepare-upload-parts':
      return prepareUploadParts(req, res);
    case 'complete-multipart-upload':
      return completeMultipartUpload(req, res);
    case 'list-parts':
      return listParts(req, res);
    case 'abort-multipart-upload':
      return abortMultipartUpload(req, res);
    case 'sign-part':
      return signPart(req, res);
  }
  return res.status(404).end();
}

export async function createMultipartUpload(req: Request, res: Response) {
  const { file } = req.body;
  const safeExt = normalizeExtension(file?.name || '');
  if (!safeExt) {
    return res.status(400).json({ message: 'Unsupported file type.' });
  }
  const safeContentType = ALLOWED_EXT_TO_MIME[safeExt];

  const declaredSize = Number(file?.size);
  if (Number.isFinite(declaredSize) && declaredSize > maxBytesForMime(safeContentType)) {
    return res.status(400).json({
      message: `File size exceeds the maximum allowed size of ${maxBytesForMime(
        safeContentType
      )} bytes.`,
    });
  }

  const key = buildKey(safeExt);

  try {
    const command = new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      ContentType: safeContentType,
    });
    const response = await S3.send(command);
    return res.status(200).json({
      uploadId: response.UploadId,
      key: response.Key,
    });
  } catch (err) {
    logger.error(`createMultipartUpload failed: ${(err as Error)?.message ?? err}`);
    return res.status(500).json({ source: { status: 500 } });
  }
}

export async function prepareUploadParts(req: Request, res: Response) {
  const { partData } = req.body;
  const parts = partData.parts;
  const response = { presignedUrls: {} as Record<number, string> };

  for (const part of parts) {
    try {
      const command = new UploadPartCommand({
        Bucket: S3_BUCKET,
        Key: partData.key,
        PartNumber: part.number,
        UploadId: partData.uploadId,
      });
      response.presignedUrls[part.number] = await getSignedUrl(S3, command, {
        expiresIn: 3600,
      });
    } catch (err) {
      logger.error(`prepareUploadParts failed: ${(err as Error)?.message ?? err}`);
      return res.status(500).json({ error: 'Upload failed' });
    }
  }

  return res.status(200).json(response);
}

export async function listParts(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  try {
    const command = new ListPartsCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });
    const response = await S3.send(command);
    return res.status(200).json(response['Parts']);
  } catch (err) {
    logger.error(`listParts failed: ${(err as Error)?.message ?? err}`);
    return res.status(500).json({ error: 'Upload failed' });
  }
}

export async function completeMultipartUpload(req: Request, res: Response) {
  const { key, uploadId, parts } = req.body;

  try {
    const command = new CompleteMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts },
    });
    const response = await S3.send(command);

    const safeExt = normalizeExtension(key || '');
    if (!safeExt) {
      await S3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      return res.status(400).json({ message: 'Unsupported file type.' });
    }
    const expectedMime = ALLOWED_EXT_TO_MIME[safeExt];

    // Verify the assembled object's real content matches the declared type.
    const head = await S3.send(
      new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: key,
        Range: 'bytes=0-4100',
      })
    );
    const chunks: Buffer[] = [];
    // @ts-ignore — Body is a Node stream on the server
    for await (const chunk of head.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const detected = await fromBuffer(Buffer.concat(chunks));

    if (!detected || detected.mime !== expectedMime) {
      await S3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      return res
        .status(400)
        .json({ message: 'File contents do not match declared type.' });
    }

    // "bytes 0-4100/<total>" on the ranged read above: the assembled size.
    const total =
      Number(head.ContentRange?.split('/')[1]) || Number(head.ContentLength);
    if (!total || total > maxBytesForMime(expectedMime)) {
      await S3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
      return res.status(400).json({
        message: `File size exceeds the maximum allowed size of ${maxBytesForMime(
          expectedMime
        )} bytes.`,
      });
    }

    response.Location = `${CDN_URL}/${key}`;
    return response;
  } catch (err) {
    logger.error(`completeMultipartUpload failed: ${(err as Error)?.message ?? err}`);
    return res.status(500).json({ error: 'Upload failed' });
  }
}

export async function abortMultipartUpload(req: Request, res: Response) {
  const { key, uploadId } = req.body;

  try {
    const command = new AbortMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: key,
      UploadId: uploadId,
    });
    const response = await S3.send(command);
    return res.status(200).json(response);
  } catch (err) {
    logger.error(`abortMultipartUpload failed: ${(err as Error)?.message ?? err}`);
    return res.status(500).json({ error: 'Upload failed' });
  }
}

export async function signPart(req: Request, res: Response) {
  const { key, uploadId } = req.body;
  const partNumber = parseInt(req.body.partNumber);

  const command = new UploadPartCommand({
    Bucket: S3_BUCKET,
    Key: key,
    PartNumber: partNumber,
    UploadId: uploadId,
  });
  const url = await getSignedUrl(S3, command, { expiresIn: 3600 });

  return res.status(200).json({ url });
}
