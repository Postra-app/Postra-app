import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';

@Injectable()
export class GetAnalyticsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'getAnalytics';

  run() {
    return createTool({
      id: 'getAnalytics',
      description: `Get analytics for one social channel (followers, engagement, reach, etc. - depends on the platform). Pass the channel/integration "id" from integrationList and how many days back to look. Only works for connected social channels.`,
      inputSchema: z.object({
        integrationId: z
          .string()
          .describe('The channel/integration id from integrationList.'),
        days: z
          .number()
          .describe('How many days back to analyse (e.g. 7, 30). Defaults to 7.')
          .nullable(),
      }),
      mcp: {
        annotations: {
          title: 'Get channel analytics',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(z.any()),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organization = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        );

        const { integrationId, days } = inputData as {
          integrationId: string;
          days: number | null;
        };

        const output = await this._integrationService.checkAnalytics(
          organization,
          integrationId,
          String(days || 7)
        );

        return { output: (output as any[]) || [] };
      },
    });
  }
}
