import { createTool } from '@mastra/core/tools';
import z from 'zod';
import { checkAuth } from '@gitroom/nestjs-libraries/chat/auth.context';
import { confirmationSummary } from '@gitroom/nestjs-libraries/chat/pending-action.service';

// The tools only the directory connector has (mcp.directory.ts).
//
// Moving and deleting a post: in Postra's own chat these two park the action
// and show an Approve card, and nothing happens until a person clicks it. An
// assistant that connects over MCP has no such card, so there the same tools
// answered "awaiting confirmation" and the post never moved or went away.
// Here they act, and say so in their annotations (destructiveHint): the
// assistant's own confirmation is the person's say. The full connector keeps
// the card.
//
// Lookups: a directory reviews every operation a model can call, so each one
// is a tool of its own with a fixed platform and a fixed method, instead of
// one tool that runs whatever method it is given.

type Context = { requestContext?: { get: (key: string) => unknown } };

const organizationOf = (context: unknown) =>
  JSON.parse(
    (context as Context)?.requestContext?.get('organization') as string
  ).id as string;

export type DirectoryActionDeps = {
  postFacts: {
    byId: (id: string, organizationId: string) => Promise<any>;
    byGroup: (organizationId: string, group: string) => Promise<any[]>;
  };
  posts: {
    deletePost: (organizationId: string, group: string) => Promise<unknown>;
    changeDate: (
      organizationId: string,
      id: string,
      date: string,
      action: 'schedule'
    ) => Promise<unknown>;
  };
  integrations: {
    getIntegrationById: (
      organizationId: string,
      id: string
    ) => Promise<{ providerIdentifier: string } | null | undefined>;
  };
  // The full connector's helper runner: it knows how to call a channel's
  // method with a fresh token. Reached only with the fixed names below.
  runLookup: (
    input: { integrationId: string; methodName: string; dataSchema: [] },
    context: unknown
  ) => Promise<{ output: unknown }>;
};

// name -> the platform it belongs to, the channel method it runs, its title
// and its description.
export const DIRECTORY_LOOKUPS: Record<
  string,
  { platform: string; method: string; title: string; description: string }
> = {
  listPinterestBoards: {
    platform: 'pinterest',
    method: 'boards',
    title: 'List Pinterest boards',
    description:
      'Lists the boards of a connected Pinterest account, each with its id and name. A Pinterest post needs the id of the board it goes to.',
  },
  listSlackChannels: {
    platform: 'slack',
    method: 'channels',
    title: 'List Slack channels',
    description:
      'Lists the channels of a connected Slack workspace, each with its id and name. A Slack post needs the id of the channel it goes to.',
  },
  listDiscordChannels: {
    platform: 'discord',
    method: 'channels',
    title: 'List Discord channels',
    description:
      'Lists the channels of a connected Discord server, each with its id and name. A Discord post needs the id of the channel it goes to.',
  },
  listWordpressPostTypes: {
    platform: 'wordpress',
    method: 'postTypes',
    title: 'List WordPress post types',
    description:
      'Lists the post types of a connected WordPress site. A WordPress post needs one of them.',
  },
};

export const DIRECTORY_ACTION_DESCRIPTIONS = {
  reschedulePost:
    'Moves an existing post to a new date and time and returns what was moved. The post is published at the new time.',
  deletePost:
    'Deletes an existing post, on every channel it was written for, and returns what was deleted. A post that is already published stays on the platform; it is removed from Postra.',
};

const readOnly = (title: string) => ({
  title,
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

export const directoryActionTools = (deps: DirectoryActionDeps) => {
  const lookups = Object.fromEntries(
    Object.entries(DIRECTORY_LOOKUPS).map(([id, lookup]) => [
      id,
      createTool({
        id,
        description: lookup.description,
        inputSchema: z.object({
          integrationId: z
            .string()
            .describe(`The id of a ${lookup.platform} channel.`),
        }),
        outputSchema: z.object({
          status: z.enum(['ok', 'not_found']),
          items: z.array(z.record(z.string(), z.any())),
        }),
        mcp: { annotations: readOnly(lookup.title) },
        execute: async (inputData, context) => {
          checkAuth(inputData, context);
          const { integrationId } = inputData as { integrationId: string };
          const channel = await deps.integrations.getIntegrationById(
            organizationOf(context),
            integrationId
          );
          // Another platform's channel has no such list, even where its
          // method carries the same name (Slack and Discord both have
          // "channels").
          if (channel?.providerIdentifier !== lookup.platform) {
            return {
              status: 'not_found' as const,
              items: [] as Record<string, unknown>[],
            };
          }
          const { output } = await deps.runLookup(
            { integrationId, methodName: lookup.method, dataSchema: [] },
            context
          );
          return {
            status: 'ok' as const,
            items: (Array.isArray(output) ? output : []) as Record<
              string,
              unknown
            >[],
          };
        },
      }),
    ])
  );

  const reschedulePost = createTool({
    id: 'reschedulePost',
    description: DIRECTORY_ACTION_DESCRIPTIONS.reschedulePost,
    inputSchema: z.object({
      id: z.string().describe('The id of the post, from listScheduledPosts.'),
      date: z.string().describe('The new date and time in UTC (ISO 8601).'),
    }),
    outputSchema: z.object({
      status: z.enum(['moved', 'not_found']),
      summary: z.string(),
    }),
    mcp: {
      annotations: {
        title: 'Move a post',
        readOnlyHint: false,
        // It overwrites when the post is published.
        destructiveHint: true,
        idempotentHint: true,
        // The post goes out on a public platform at the new time.
        openWorldHint: true,
      },
    },
    execute: async (inputData, context) => {
      checkAuth(inputData, context);
      const organizationId = organizationOf(context);
      const { id, date } = inputData as { id: string; date: string };
      const post = await deps.postFacts.byId(id, organizationId);
      if (!post) {
        return {
          status: 'not_found' as const,
          summary: 'No post with this id in this workspace.',
        };
      }
      const summary = confirmationSummary('reschedulePost', [post], date);
      await deps.posts.changeDate(organizationId, id, date, 'schedule');
      return { status: 'moved' as const, summary };
    },
  });

  const deletePost = createTool({
    id: 'deletePost',
    description: DIRECTORY_ACTION_DESCRIPTIONS.deletePost,
    inputSchema: z.object({
      group: z
        .string()
        .describe('The group id of the post, from listScheduledPosts.'),
    }),
    outputSchema: z.object({
      status: z.enum(['deleted', 'not_found']),
      summary: z.string(),
    }),
    mcp: {
      annotations: {
        title: 'Delete a post',
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    execute: async (inputData, context) => {
      checkAuth(inputData, context);
      const organizationId = organizationOf(context);
      const { group } = inputData as { group: string };
      const posts = await deps.postFacts.byGroup(organizationId, group);
      if (!posts?.length) {
        return {
          status: 'not_found' as const,
          summary: 'No post with this group id in this workspace.',
        };
      }
      const summary = confirmationSummary('deletePost', posts);
      await deps.posts.deletePost(organizationId, group);
      return { status: 'deleted' as const, summary };
    },
  });

  return { ...lookups, reschedulePost, deletePost };
};
