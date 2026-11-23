import { readFileSync } from 'fs';
import { join } from 'path';
import {
  MAX_TOOL_CALLS_PER_REQUEST,
  mcpBatchRefusal,
  mcpBatchRefusalAnswer,
  toolCallsIn,
} from './mcp.batch';

const call = (name: string, id: number) => ({
  jsonrpc: '2.0',
  id,
  method: 'tools/call',
  params: { name, arguments: {} },
});

// One request used to be one count against the limit and up to a hundred
// tool runs.
describe('a batch of MCP calls', () => {
  it('a single call and a small batch go through', () => {
    expect(mcpBatchRefusal(call('integrationList', 1))).toBeNull();
    expect(mcpBatchRefusal([call('integrationList', 1), call('uploadFromUrlTool', 2)])).toBeNull();
    expect(mcpBatchRefusal([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }])).toBeNull();
  });

  it('a hundred imports from an address in one request are refused', () => {
    const batch = Array.from({ length: 100 }, (_, i) => call('uploadFromUrlTool', i));
    expect(mcpBatchRefusal(batch)).toMatch(/at most 10 tool calls/);
  });

  it('more than two imports are refused even in a small batch', () => {
    const batch = [1, 2, 3].map((i) => call('uploadFromUrlTool', i));
    expect(mcpBatchRefusal(batch)).toMatch(/at most 2 files/);
  });

  it('every call in the batch gets the answer, by its id', () => {
    const batch = Array.from({ length: MAX_TOOL_CALLS_PER_REQUEST + 1 }, (_, i) => call('integrationList', i));
    const answer = mcpBatchRefusalAnswer(batch, 'no') as any[];
    expect(answer.map((a) => a.id)).toEqual(batch.map((m) => m.id));
    expect(answer[0].result).toEqual({ content: [{ type: 'text', text: 'no' }], isError: true });
  });

  it('counts only tool calls', () => {
    expect(toolCallsIn([{ method: 'initialize' }, call('x', 1), null])).toHaveLength(1);
    expect(toolCallsIn(undefined)).toEqual([]);
  });
});

// start.mcp.ts pulls Mastra and the whole agent; read as source for the wiring.
// The OAuth route, and the one handler behind /mcp and /mcp-directory.
it('every MCP endpoint refuses an oversized batch and counts its calls', () => {
  const src = readFileSync(join(__dirname, 'start.mcp.ts'), 'utf8');
  for (const start of ["app.use('/mcp-oauth'", 'const bearerRoute =']) {
    const from = src.indexOf(start);
    expect(from).toBeGreaterThan(-1);
    const body = src.slice(from, src.indexOf('.startHTTP(', from));
    expect(body.indexOf('refusedBatch(')).toBeGreaterThan(body.indexOf('readBody(req, res)'));
    expect(body.indexOf('refusedBatch(')).toBeLessThan(body.indexOf('agentRunRefusal('));
  }
});
