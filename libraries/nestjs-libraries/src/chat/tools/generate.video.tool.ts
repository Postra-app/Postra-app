import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import {
  IntegrationManager,
  socialIntegrationList,
} from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GenerateVideoTool implements AgentToolInterface {
  constructor(
    private _mediaService: MediaService,
    private _videoManager: VideoManager
  ) {}
  name = 'generateVideoTool';

  run() {
    return createTool({
      id: 'generateVideoTool',
      mcp: {
        annotations: {
          title: 'Generate Video',
          readOnlyHint: false,
          destructiveHint: false,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      description: `Start making a video to use in a post. A video takes a few minutes, so this only starts it:
                    tell the user it is being made and will be in their media library (with a notification) in a few minutes,
                    and do not wait for it or call this tool again for the same video.
                    Generate video to use in a post,
                    in case the user specified a platform that requires attachment and attachment was not provided,
                    ask if they want to generate a picture of a video.
                    In many cases 'videoFunctionTool' will need to be called first, to get things like voice id
                    Here are the type of video that can be generated:
                    ${this._videoManager
                      .getAllVideos()
                      .map((p) => "-" + p.title)
                      .join('\n')}
      `,
      inputSchema: z.object({
        identifier: z.string(),
        output: z.enum(['vertical', 'horizontal']),
        customParams: z.array(
          z.object({
            key: z.string().describe('Name of the settings key to pass'),
            value: z.any().describe('Value of the key'),
          })
        ),
      }),
      outputSchema: z.object({
        status: z.enum(['started', 'done']),
        url: z.string().optional(),
        message: z.string(),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const org = JSON.parse((context?.requestContext as any)?.get('organization') as string);
        // A clip takes minutes, longer than an assistant run: start it and
        // let the server finish it into the library.
        const value = await this._mediaService.startVideo(org, {
          type: inputData.identifier,
          output: inputData.output,
          customParams: inputData.customParams.reduce(
            (all: Record<string, any>, current: { key: string; value: any }) => ({
              ...all,
              [current.key]: current.value,
            }),
            {} as Record<string, any>
          ),
        });

        if (value.status === 'done' && value.media) {
          return {
            status: 'done' as const,
            url: value.media.path,
            message: 'This video was made a few minutes ago and is in the media library.',
          };
        }
        return {
          status: 'started' as const,
          message:
            'The video is being made. It takes a few minutes and will be in the media library, with a notification, when it is ready.',
        };
      },
    });
  }
}
