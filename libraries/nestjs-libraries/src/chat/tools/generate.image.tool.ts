import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GenerateImageTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'generateImageTool';

  run() {
    return createTool({
      id: 'generateImageTool',
      description: `Generate an image with AI to use in a post, saved to the media library.
                    When a platform requires an attachment and the user gave none,
                    ask whether they want a picture or a video generated.
      `,
      mcp: {
        annotations: {
          title: 'Generate Image',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        prompt: z.string(),
      }),
      outputSchema: z.object({
        id: z.string(),
        path: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse((context?.requestContext as any)?.get('organization') as string);

        // The Brand Kit is applied inside MediaService.generateImage now, so
        // every AI image surface gets the same palette — this tool used to be
        // the only one that did it, and the composer's images went unbranded.
        //
        // generateImage already uploads the image and returns its CDN URL, so
        // just persist that. (It used to re-wrap the returned URL as a base64
        // data URL and re-upload it — decoding a URL as base64 yielded garbage
        // bytes and an "Unsupported file type" error.)
        const url = await this._mediaService.generateImage(
          inputData.prompt,
          org,
          false,
          'agent'
        );
        if (!url) {
          throw new Error('Image generation returned no image.');
        }

        return this._mediaService.saveFile(
          org.id,
          url.split('/').pop(),
          url,
          undefined,
          true
        );
      },
    });
  }
}
