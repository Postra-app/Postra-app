import { readFileSync } from 'fs';
import { join } from 'path';

// start.mcp.ts pulls Mastra and the whole agent; read as source for the
// wiring, and the stack test (e2e/stack/api/mcp.spec.ts) asks the running
// server. A GET to the stateless MCP endpoint got an event stream that never
// ended (measured against @mastra/mcp: 200 text/event-stream, still open
// after 5 s) instead of 405 (upstream #1850).
const src = readFileSync(join(__dirname, 'start.mcp.ts'), 'utf8');

it('both MCP endpoints refuse anything but POST, after authorization', () => {
  const handler = (path: string) => src.slice(src.indexOf(`app.use('${path}'`), src.indexOf('server.startHTTP', src.indexOf(`app.use('${path}'`)));
  for (const path of ['/mcp-oauth', '/mcp']) {
    const body = handler(path);
    const refusal = body.indexOf('refuseNonPost(req, res)');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(body.search(/oauthMiddleware\(req, res, url\)|resolveAuth\(token\)/));
    expect(refusal).toBeLessThan(body.indexOf('readBody(req, res)'));
  }
});
