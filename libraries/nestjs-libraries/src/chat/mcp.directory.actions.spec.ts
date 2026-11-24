import {
  DIRECTORY_ACTION_DESCRIPTIONS,
  DIRECTORY_LOOKUPS,
  directoryActionTools,
} from './mcp.directory.actions';

// The directory connector's own tools. Over MCP there is no Approve card, so
// moving and deleting a post act and say so in their annotations; and each
// lookup of a channel is a tool with one platform and one method.
const context = {
  requestContext: {
    get: (key: string) =>
      key === 'organization'
        ? JSON.stringify({ id: 'org-1', createdAt: '2026-01-05T00:00:00.000Z' })
        : undefined,
  },
};

const build = (over: Record<string, unknown> = {}) => {
  const deps = {
    postFacts: {
      byId: jest.fn(async () => ({
        publishDate: '2026-11-25T09:00:00.000Z',
        content: '<p>Hello</p>',
        integration: { name: 'Postra', providerIdentifier: 'facebook' },
      })),
      byGroup: jest.fn(async () => [
        {
          publishDate: '2026-11-25T09:00:00.000Z',
          content: '<p>Hello</p>',
          integration: { name: 'Postra', providerIdentifier: 'facebook' },
        },
      ]),
    },
    posts: { deletePost: jest.fn(async () => ({})), changeDate: jest.fn(async () => ({})) },
    postCap: jest.fn(async () => ({ limit: 30, anchor: '2026-01-05T00:00:00.000Z' })),
    integrations: {
      getIntegrationById: jest.fn(async () => ({ providerIdentifier: 'slack' })),
    },
    runLookup: jest.fn(async () => ({ output: [{ id: 'C1', name: 'social' }] })),
    ...over,
  };
  return { deps, tools: directoryActionTools(deps as any) as Record<string, any> };
};

describe("the directory connector's own tools", () => {
  it('deletes the post itself and says what it deleted', async () => {
    const { deps, tools } = build();
    const result = await tools.deletePost.execute({ group: 'g-1' }, context);
    expect(deps.posts.deletePost).toHaveBeenCalledWith('org-1', 'g-1');
    expect(result.status).toBe('deleted');
    expect(result.summary).toContain('Delete the post on facebook "Postra"');
  });

  it('moves the post itself and says what it moved', async () => {
    const { deps, tools } = build();
    const result = await tools.reschedulePost.execute(
      { id: 'p-1', date: '2026-11-26T10:00:00.000Z' },
      context
    );
    // With the plan's allowance: without it the move skipped the monthly
    // limit the calendar and the API enforce.
    expect(deps.postCap).toHaveBeenCalledWith('org-1', '2026-01-05T00:00:00.000Z');
    expect(deps.posts.changeDate).toHaveBeenCalledWith(
      'org-1',
      'p-1',
      '2026-11-26T10:00:00.000Z',
      'schedule',
      false,
      { limit: 30, anchor: '2026-01-05T00:00:00.000Z' }
    );
    expect(result.status).toBe('moved');
    expect(result.summary).toContain('to 2026-11-26 10:00 UTC');
  });

  it('says the plan has no posts left instead of failing, and says nothing was moved', async () => {
    const refusal = Object.assign(new Error('payment required'), {
      getStatus: () => 402,
      getResponse: () => ({ section: 'posts_per_month', action: 'create' }),
    });
    const { tools } = build({
      posts: { deletePost: jest.fn(), changeDate: jest.fn(async () => { throw refusal; }) },
    });
    const result = await tools.reschedulePost.execute({ id: 'p-1', date: '2026-12-02T10:00:00.000Z' }, context);
    expect(result.status).toBe('refused');
    expect(result.summary).toBe('The plan has no posts left in the month this date falls in.');
  });

  it('does not turn a server failure into a refusal', async () => {
    const { tools } = build({
      posts: { deletePost: jest.fn(), changeDate: jest.fn(async () => { throw new Error('connection lost'); }) },
    });
    await expect(
      tools.reschedulePost.execute({ id: 'p-1', date: '2026-12-02T10:00:00.000Z' }, context)
    ).rejects.toThrow('connection lost');
  });

  it('says a moved draft is still a draft', async () => {
    const { tools } = build({
      postFacts: {
        byId: jest.fn(async () => ({
          state: 'DRAFT',
          publishDate: '2026-11-25T09:00:00.000Z',
          content: '<p>Hello</p>',
          integration: { name: 'Postra', providerIdentifier: 'facebook' },
        })),
        byGroup: jest.fn(async (): Promise<unknown[]> => []),
      },
    });
    const result = await tools.reschedulePost.execute({ id: 'p-1', date: '2026-11-26T10:00:00.000Z' }, context);
    expect(result.status).toBe('draft_moved');
    expect(result.summary).toContain('stays a draft');
    expect(DIRECTORY_ACTION_DESCRIPTIONS.reschedulePost).toContain('a draft stays a draft');
  });

  it('a lookup that could not be read says so instead of an empty list', async () => {
    const { tools } = build({
      runLookup: jest.fn(async () => ({ output: 'We had to disconnect the channel as the token expired' })),
    });
    const result = await tools.listSlackChannels.execute({ integrationId: 'ch-1' }, context);
    expect(result.status).toBe('unavailable');
    expect(result.items).toEqual([]);
    expect(result.message).toContain('token expired');
  });

  it("touches nothing when the post is not this workspace's", async () => {
    const { deps, tools } = build({
      postFacts: { byId: jest.fn(async (): Promise<null> => null), byGroup: jest.fn(async (): Promise<unknown[]> => []) },
    });
    expect((await tools.deletePost.execute({ group: 'g-9' }, context)).status).toBe('not_found');
    expect((await tools.reschedulePost.execute({ id: 'p-9', date: '2026-11-26T10:00:00.000Z' }, context)).status).toBe('not_found');
    expect(deps.posts.deletePost).not.toHaveBeenCalled();
    expect(deps.posts.changeDate).not.toHaveBeenCalled();
  });

  it('marks both as changing data in a way that cannot be taken for a read', () => {
    const { tools } = build();
    for (const id of ['deletePost', 'reschedulePost']) {
      expect(tools[id].mcp.annotations.readOnlyHint).toBe(false);
      expect(tools[id].mcp.annotations.destructiveHint).toBe(true);
    }
  });

  it('has one read-only lookup per platform, each with a fixed method', async () => {
    const { deps, tools } = build();
    expect(Object.keys(DIRECTORY_LOOKUPS).sort()).toEqual([
      'listDiscordChannels',
      'listPinterestBoards',
      'listSlackChannels',
      'listWordpressPostTypes',
    ]);
    const result = await tools.listSlackChannels.execute({ integrationId: 'i-1' }, context);
    expect(deps.runLookup).toHaveBeenCalledWith(
      { integrationId: 'i-1', methodName: 'channels', dataSchema: [] },
      context
    );
    expect(result).toEqual({ status: 'ok', items: [{ id: 'C1', name: 'social' }] });
    for (const id of Object.keys(DIRECTORY_LOOKUPS)) {
      expect(tools[id].mcp.annotations.readOnlyHint).toBe(true);
      // The caller names a channel and nothing else: no method to choose.
      expect(Object.keys(tools[id].inputSchema.shape)).toEqual(['integrationId']);
    }
  });

  // Slack and Discord both call their method "channels".
  it("does not run a lookup on another platform's channel", async () => {
    const { deps, tools } = build();
    const result = await tools.listDiscordChannels.execute({ integrationId: 'i-1' }, context);
    expect(result).toEqual({ status: 'not_found', items: [] });
    expect(deps.runLookup).not.toHaveBeenCalled();
  });

  it('describes each tool without telling the model how to behave, and without a card it cannot show', () => {
    const instruction =
      /\b(call it|call this|do not|don't|never|always|you must|you should|tell the user|ask the user|ask them|just run|confirmation card)\b/i;
    const descriptions = [
      ...Object.values(DIRECTORY_ACTION_DESCRIPTIONS),
      ...Object.values(DIRECTORY_LOOKUPS).map((l) => l.description),
    ];
    for (const description of descriptions) {
      expect(description).not.toMatch(instruction);
    }
  });
});
