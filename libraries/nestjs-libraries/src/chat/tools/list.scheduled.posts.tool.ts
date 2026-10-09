import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { Injectable } from '@nestjs/common';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import dayjs from 'dayjs';

@Injectable()
export class ListScheduledPostsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'listScheduledPosts';

  run() {
    return createTool({
      id: 'listScheduledPosts',
      description: `List the user's existing posts (their content calendar) between two dates: scheduled, queued, drafts, published and errored. Use this to see what is already planned before scheduling something new, or to find a post the user wants to change - reschedule it with its "id", delete it with its "group". An errored post carries the reason in "error".`,
      inputSchema: z.object({
        startDate: z
          .string()
          .describe('ISO date-time in UTC - start of the range. Defaults to now.')
          .nullable(),
        endDate: z
          .string()
          .describe('ISO date-time in UTC - end of the range. Defaults to 30 days from now.')
          .nullable(),
      }),
      mcp: {
        annotations: {
          title: 'List scheduled posts',
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      },
      outputSchema: z.object({
        output: z.array(
          z.object({
            id: z.string(),
            group: z.string(),
            date: z.string(),
            state: z.string(),
            error: z
              .string()
              .nullable()
              .describe('Why publishing failed, for errored posts; null otherwise'),
            channel: z.string(),
            platform: z.string(),
            preview: z.string(),
            url: z.string(),
          })
        ),
      }),
      execute: async (inputData, context) => {
        checkAuth(inputData, context);
        const organizationId = JSON.parse(
          (context?.requestContext as any)?.get('organization') as string
        ).id;

        const startDate =
          (inputData as any)?.startDate || dayjs().toISOString();
        const endDate =
          (inputData as any)?.endDate ||
          dayjs().add(30, 'day').toISOString();

        const posts = await this._postsService.getPosts(organizationId, {
          startDate,
          endDate,
        } as any);

        return {
          output: (posts || []).map((p: any) => ({
            id: p.id,
            group: p.group,
            date: dayjs(p.publishDate).toISOString(),
            state: p.state,
            error: p.error ?? null,
            channel: p.integration?.name || '',
            platform: p.integration?.providerIdentifier || '',
            preview: String(
              typeof p.content === 'string'
                ? p.content
                : JSON.stringify(p.content ?? '')
            )
              .replace(/<[^>]*>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 160),
            url: p.releaseURL || '',
          })),
        };
      },
    });
  }
}
