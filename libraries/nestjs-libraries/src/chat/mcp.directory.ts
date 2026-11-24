// The connector as a public directory of MCP connectors lists it. Such
// directories set rules the full connector does not meet: no tools that
// generate images, video or audio with AI, no tool that both reads and
// writes on request (the assistant behind `ask_postra` does both), and tool
// descriptions that say what a tool does without telling the model how to
// behave. This is the same server with fewer tools and plain descriptions;
// the full set stays at /mcp for people who add the connector themselves.
// Moving and deleting a post, and the lookups of a channel, are tools of the
// directory's own (mcp.directory.actions.ts).

// Tool id -> the description shown in a directory.
export const DIRECTORY_TOOLS: Record<string, string> = {
  integrationList:
    'Lists the social channels connected to the workspace, with the id, name and platform of each.',
  integrationSchema:
    'Returns the rules and settings of one platform: the maximum post length, the media it requires and the settings a post needs.',
  listScheduledPosts:
    'Lists the posts of the workspace between two dates: drafts, scheduled, published and failed, each with its state, channel, first words, link and error.',
  mediaListTool:
    'Lists the images and videos in the media library, newest first, 18 per page, optionally filtered by file name.',
  getAnalytics:
    'Returns the analytics of one connected channel for a number of days. The metrics depend on the platform.',
  integrationSchedulePostTool:
    "Creates one or more posts on connected channels as drafts, scheduled posts or posts published now. A post can carry comments or thread parts, attachments from the media library and the platform's settings.",
  uploadFromUrlTool:
    'Copies an image or a video from a public http(s) address into the media library and returns its id and hosted address.',
};

// What a client needs to know to use the tools together. It lives here, in
// the server's instructions, because a tool's description may only describe
// the tool.
export const DIRECTORY_INSTRUCTIONS = [
  'Postra schedules social media posts for the signed-in workspace.',
  'Channel ids come from integrationList. The settings a platform needs come from integrationSchema; the ids some settings take come from listPinterestBoards, listSlackChannels, listDiscordChannels and listWordpressPostTypes.',
  'Dates are ISO 8601 in UTC. Post text is HTML with each line in a <p> element.',
  'Attachments are addresses from the media library (mediaListTool or uploadFromUrlTool).',
  'A post created with type "draft" is saved without a publish action; "schedule" publishes at the given date; "now" publishes at once.',
].join(' ');

// A copy of each listed tool with its directory description, and the
// directory's own tools beside them. The shared tools stay as they are for
// the full server, annotations included: each says truthfully whether it
// reads, adds or can destroy.
export const directoryTools = <T extends object>(
  tools: Record<string, T>,
  own: Record<string, T> = {}
): Record<string, T> => ({
  ...Object.fromEntries(
    Object.entries(DIRECTORY_TOOLS)
      .filter(([id]) => tools[id])
      .map(([id, description]) => {
        const tool = tools[id];
        return [
          id,
          Object.assign(Object.create(Object.getPrototypeOf(tool)), tool, {
            description,
          }) as T,
        ];
      })
  ),
  ...own,
});

// What an assistant shows the person when their workspace has no plan, on
// either connector. It says why there is no answer and nothing about buying
// a plan.
export const NO_PLAN =
  'This Postra workspace has no active plan. The connector works for a workspace with an active plan.';
