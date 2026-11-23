import {
  AgentToolInterface,
} from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { VideoManager } from '@gitroom/nestjs-libraries/videos/video.manager';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GenerateVideoOptionsTool implements AgentToolInterface {
  constructor(private _videoManagerService: VideoManager) {}
  name = 'generateVideoOptions';

  run() {
    return createTool({
      id: 'generateVideoOptions',
      description: `List the kinds of video this workspace can generate and the inputs each one takes. Some kinds need a value from videoFunctionTool first (a voice id, for example).`,
      inputSchema: z.object({}),
      mcp: {
        annotations: {
          title: 'List Video Generation Options',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        video: z.array(
          z.object({
            type: z.string(),
            output: z.string(),
            tools: z.array(
              z.object({
                functionName: z.string(),
                output: z.string(),
              })
            ),
            customParams: z.any(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const videos = this._videoManagerService.getAllVideos();
        return {
          video: videos.map((p) => {
            return {
              type: p.identifier,
              output: 'vertical|horizontal',
              tools: p.tools,
              customParams: getValidationSchemas()[p.dto.name],
            };
          }),
        };
      },
    });
  }
}
