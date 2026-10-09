import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class CreateBrandedDraftTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'createBrandedDraft';

  run() {
    return createTool({
      id: 'createBrandedDraft',
      description: `Create a complete, ready-to-post branded post in ONE step: writes the caption in the brand voice AND designs a matching on-brand graphic (headline / subtext / call-to-action over an AI-generated background), rendered to an image saved in the media library.
      Use this whenever the user wants a finished branded post or graphic about a topic - instead of separately writing text and generating an image. Returns the caption plus the design's media id and path, so you can open the composer prefilled with both the copy and the attached graphic.`,
      mcp: {
        annotations: {
          title: 'Create Branded Draft',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      inputSchema: z.object({
        topic: z
          .string()
          .describe('What the post is about - the subject, offer or announcement.'),
        platform: z
          .string()
          .describe(
            'Target social platform, e.g. instagram, facebook, linkedin, x, tiktok, threads.'
          ),
        language: z
          .string()
          .describe(
            'Language for ALL text in the post - the caption AND the on-image headline/subtext/CTA, so they match. Infer it from the language the user is writing in, e.g. "English" or "Polish".'
          ),
      }),
      outputSchema: z.object({
        copy: z.string(),
        mediaId: z.string(),
        path: z.string(),
        headline: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        return this._mediaService.createBrandedDraft(org, {
          prompt: inputData.topic,
          platform: inputData.platform,
          language: inputData.language,
        });
      },
    });
  }
}
