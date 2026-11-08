import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import 'multer';
import { makeId } from '@gitroom/nestjs-libraries/services/make.is';
import { IUploadProvider, StoredObject } from './upload.interface';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
// Use undici's fetch (not Node's global fetch): the `dispatcher` option only
// interoperates with an Agent from the same undici instance. Passing our
// undici@8 Agent to the global fetch of Node's own bundled undici throws
// "invalid onRequestStart method", so every remote upload silently failed.
import { fetch } from 'undici';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';
import { ownMediaHosts } from '@gitroom/helpers/utils/own.media.url';

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
]);

export class S3Storage implements IUploadProvider {
  private _client: S3Client;

  constructor(
    private _bucketName: string,
    private _region: string,
    private _cdnUrl: string,
    accessKeyId?: string,
    secretAccessKey?: string
  ) {
    const clientConfig: ConstructorParameters<typeof S3Client>[0] = {
      region: _region,
    };

    // Static credentials for local dev; on EC2 the instance role is used
    // automatically via the default credential chain.
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this._client = new S3Client(clientConfig);
  }

  private buildKey(id: string, extension: string): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}/${m}/${d}/${id}.${extension}`;
  }

  async uploadSimple(path: string): Promise<string> {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(path))) {
        throw new Error('Unsafe URL');
      }
      const res = await fetch(path, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      body = Buffer.from(await res.arrayBuffer());
    }

    const detected = await fromBuffer(body);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const id = makeId(10);
    const key = this.buildKey(id, detected.ext);

    await this._client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: key,
        Body: body,
        ContentType: detected.mime,
      })
    );

    return `${this._cdnUrl}/${key}`;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    const detected = await fromBuffer(file.buffer);
    if (!detected || !ALLOWED_MIME_TYPES.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const id = makeId(10);
    const key = this.buildKey(id, detected.ext);

    await this._client.send(
      new PutObjectCommand({
        Bucket: this._bucketName,
        Key: key,
        Body: file.buffer,
        ContentType: detected.mime,
      })
    );

    const publicUrl = `${this._cdnUrl}/${key}`;

    return {
      filename: `${id}.${detected.ext}`,
      mimetype: detected.mime,
      size: file.size,
      buffer: file.buffer,
      originalname: `${id}.${detected.ext}`,
      fieldname: 'file',
      path: publicUrl,
      destination: publicUrl,
      encoding: '7bit',
      stream: file.buffer as any,
    };
  }

  async sizeOf(filePath: string): Promise<number | null> {
    // Only our own bucket: the CDN address of today, or any other name the
    // app accepts as its own media host (the bucket was served under an
    // earlier CDN name, and older library rows keep that address).
    let url: URL;
    try {
      url = new URL(filePath);
    } catch {
      return null;
    }
    const own =
      (!!this._cdnUrl && filePath.startsWith(this._cdnUrl + '/')) ||
      ownMediaHosts().includes(url.host.toLowerCase());
    if (!own) {
      return null;
    }
    try {
      const key = url.pathname.replace(/^\//, '');
      const head = await this._client.send(
        new HeadObjectCommand({ Bucket: this._bucketName, Key: key })
      );
      return Number(head.ContentLength) || null;
    } catch {
      return null;
    }
  }

  async *listStored(): AsyncGenerator<StoredObject> {
    let token: string | undefined;
    do {
      const page = await this._client.send(
        new ListObjectsV2Command({
          Bucket: this._bucketName,
          ContinuationToken: token,
        })
      );
      for (const item of page.Contents ?? []) {
        if (!item.Key) continue;
        yield {
          key: item.Key,
          path: `${this._cdnUrl}/${item.Key}`,
          lastModified: item.LastModified ?? new Date(),
          size: Number(item.Size) || 0,
        };
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }

  async removeStored(item: StoredObject): Promise<void> {
    await this._client.send(
      new DeleteObjectCommand({ Bucket: this._bucketName, Key: item.key })
    );
  }

  async removeFile(filePath: string): Promise<void> {
    try {
      const url = new URL(filePath);
      const key = url.pathname.replace(/^\//, '');
      await this._client.send(
        new DeleteObjectCommand({
          Bucket: this._bucketName,
          Key: key,
        })
      );
    } catch (err) {
      console.error('S3Storage.removeFile failed:', err);
    }
  }
}
