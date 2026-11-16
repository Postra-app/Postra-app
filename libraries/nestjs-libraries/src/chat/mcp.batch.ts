// One MCP request can carry many calls (JSON-RPC batch, up to 100 in the
// SDK). The rate limit counted requests, so one request was a hundred tool
// runs, and a hundred imports from an address were a hundred files of up to
// 100 MB held in memory at once on a backend with 3.7 GiB.
export const MAX_TOOL_CALLS_PER_REQUEST = 10;
export const MAX_URL_IMPORTS_PER_REQUEST = 2;

const messages = (body: unknown): any[] =>
  Array.isArray(body) ? body : body ? [body] : [];

export const toolCallsIn = (body: unknown) =>
  messages(body).filter((m) => m?.method === 'tools/call');

// What to answer instead of running the batch, if anything.
export const mcpBatchRefusal = (body: unknown): string | null => {
  const calls = toolCallsIn(body);
  if (calls.length > MAX_TOOL_CALLS_PER_REQUEST) {
    return `Send at most ${MAX_TOOL_CALLS_PER_REQUEST} tool calls in one request.`;
  }
  const imports = calls.filter((m) => m?.params?.name === 'uploadFromUrlTool');
  if (imports.length > MAX_URL_IMPORTS_PER_REQUEST) {
    return `Import at most ${MAX_URL_IMPORTS_PER_REQUEST} files from a URL in one request.`;
  }
  return null;
};

// Every tool call in the request gets the refusal as its result.
export const mcpBatchRefusalAnswer = (body: unknown, text: string) => {
  const answers = toolCallsIn(body).map((m) => ({
    jsonrpc: '2.0',
    id: m.id,
    result: { content: [{ type: 'text', text }], isError: true },
  }));
  return Array.isArray(body) ? answers : answers[0];
};
