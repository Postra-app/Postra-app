import {
  DIRECTORY_INSTRUCTIONS,
  DIRECTORY_TOOLS,
  directoryTools,
} from './mcp.directory';

// What a directory of MCP connectors asks of every listed server.
const fullSet = [
  'integrationList',
  'integrationSchema',
  'triggerTool',
  'integrationSchedulePostTool',
  'generateVideoOptions',
  'videoFunctionTool',
  'generateVideoTool',
  'generateImageTool',
  'createBrandedDraft',
  'uploadFromUrlTool',
  'mediaListTool',
  'listScheduledPosts',
  'reschedulePost',
  'deletePost',
  'getAnalytics',
  'ask_postra',
];
class FakeTool {
  constructor(public id: string, public description: string) {}
  execute() {
    return this.id;
  }
}
const tools = Object.fromEntries(
  fullSet.map((id) => [
    id,
    new FakeTool(id, `Call ${id} first, do not ask the user.`),
  ])
);

describe('the connector a directory lists', () => {
  const listed = directoryTools(tools);

  it('has no tool that generates images, video or audio with AI', () => {
    expect(Object.keys(listed)).not.toEqual(
      expect.arrayContaining([
        'generateImageTool',
        'generateVideoTool',
        'generateVideoOptions',
        'videoFunctionTool',
        'createBrandedDraft',
      ])
    );
  });

  it('has no tool that reads and writes on request', () => {
    expect(listed.ask_postra).toBeUndefined();
  });

  it('lists the ten tools for channels, posts, media and analytics', () => {
    expect(Object.keys(listed).sort()).toEqual(
      [
        'deletePost',
        'getAnalytics',
        'integrationList',
        'integrationSchedulePostTool',
        'integrationSchema',
        'listScheduledPosts',
        'mediaListTool',
        'reschedulePost',
        'triggerTool',
        'uploadFromUrlTool',
      ].sort()
    );
  });

  it('describes each tool without telling the model how to behave', () => {
    // Imperatives addressed to the model, and the phrases they came with.
    const instruction =
      /\b(call it|call this|do not|don't|never|always|you must|you should|tell the user|ask the user|ask them|just run|first:)\b/i;
    for (const description of Object.values(DIRECTORY_TOOLS)) {
      expect(description).not.toMatch(instruction);
    }
  });

  it('keeps the tool working and leaves the full server its own description', () => {
    expect(listed.integrationList.execute()).toBe('integrationList');
    expect(listed.integrationList.description).toBe(
      DIRECTORY_TOOLS.integrationList
    );
    expect(tools.integrationList.description).toContain(
      'Call integrationList first'
    );
  });

  it('marks a tool that adds or moves something as one that changes data', () => {
    const upload = Object.assign(new FakeTool('uploadFromUrlTool', 'x'), {
      mcp: { annotations: { title: 'Upload', readOnlyHint: false, destructiveHint: false } },
    });
    const copy = directoryTools({ uploadFromUrlTool: upload }).uploadFromUrlTool;
    expect(copy.mcp.annotations).toEqual({ title: 'Upload', readOnlyHint: false, destructiveHint: true });
    expect(upload.mcp.annotations.destructiveHint).toBe(false);
  });

  it('skips a tool the server does not have', () => {
    expect(
      Object.keys(directoryTools({ integrationList: tools.integrationList }))
    ).toEqual(['integrationList']);
  });

  it('carries the usage notes in the server instructions', () => {
    expect(DIRECTORY_INSTRUCTIONS).toContain('integrationList');
    expect(DIRECTORY_INSTRUCTIONS).toContain('UTC');
  });
});
