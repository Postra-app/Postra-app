import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { readResponseCapped } from '@gitroom/nestjs-libraries/media/fetch.media.buffer';
import { Readable } from 'stream';
// Use undici's fetch (not Node's global fetch): the `dispatcher` option only
// interoperates with an Agent from the same undici instance.
import { fetch } from 'undici';
import { fromBuffer } from '@gitroom/nestjs-libraries/upload/file.type';

// Where a file this tool cannot fetch goes instead (upstream 0992c460).
const PRIVATE_FILES =
  'Only public http(s) URLs work: upload local or private files with the public API (POST /public/v1/upload with an API key from Settings → Developers).';

// Same allow-list as the public API /upload-from-url route.
const ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
]);

@Injectable()
export class UploadFromUrlTool implements AgentToolInterface {
  private storage = UploadFactory.createStorage();

  constructor(private _mediaService: MediaService) {}
  name = 'uploadFromUrlTool';

  run() {
    return createTool({
      id: 'uploadFromUrlTool',
      description: `Upload a remote image or video into the media library from a public http(s) URL.
Local or private files cannot be fetched by this tool: upload them with the public API (POST /public/v1/upload with an API key).
Use this before scheduling a post when the user provides an external media URL (not already hosted on our domain),
so the attachment passes the upload-domain validation. Returns the hosted media { id, path } to use as an attachment.`,
      mcp: {
        annotations: {
          title: 'Upload Media From URL',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        url: z
          .string()
          .url()
          .describe(
            'The public http(s) URL of the image or video to upload. Local files and private hosts are not supported, use POST /public/v1/upload instead'
          ),
      }),
      outputSchema: z
        .object({
          id: z.string(),
          path: z.string(),
        })
        .or(z.object({ errors: z.string() })),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        let response: Awaited<ReturnType<typeof fetch>>;
        try {
          response = await fetch(inputData.url, {
            // @ts-ignore — undici option, not in lib.dom fetch types
            dispatcher: ssrfSafeDispatcher,
            signal: AbortSignal.timeout(60_000),
          });
        } catch (err) {
          // A private address is refused by the SSRF guard: it threw.
          const cause = (err as { cause?: Error })?.cause?.message;
          return {
            errors: `Failed to fetch URL${cause ? ` (${cause})` : ''}. ${PRIVATE_FILES}`,
          };
        }

        if (!response.ok) {
          return { errors: `Failed to fetch URL. ${PRIVATE_FILES}` };
        }

        let buffer: Buffer;
        try {
          buffer = await readResponseCapped(response as any);
        } catch (err) {
          return { errors: (err as Error).message };
        }
        const detected = await fromBuffer(buffer);
        if (!detected || !ALLOWED_MIME.has(detected.mime)) {
          return { errors: 'Unsupported file type.' };
        }

        const getFile = await this.storage.uploadFile({
          buffer,
          mimetype: detected.mime,
          size: buffer.length,
          path: '',
          fieldname: '',
          destination: '',
          stream: new Readable(),
          filename: '',
          originalname: `upload.${detected.ext}`,
          encoding: '',
        });

        return this._mediaService.saveFile(
          org.id,
          getFile.originalname,
          getFile.path
        );
      },
    });
  }
}
