import { readFileSync } from 'fs';
import { join } from 'path';

// start.mcp.ts pulls Mastra and the whole agent; read as source for the
// wiring, and the stack test (e2e/stack/api/mcp.spec.ts) asks the running
// server. A GET to the stateless MCP endpoint got an event stream that never
// ended (measured against @mastra/mcp: 200 text/event-stream, still open
// after 5 s) instead of 405 (upstream #1850).
const src = readFileSync(join(__dirname, 'start.mcp.ts'), 'utf8');

// The OAuth route, and the one handler behind /mcp and /mcp-directory.
it('every MCP endpoint refuses anything but POST, after authorization', () => {
  const handler = (start: string) => src.slice(src.indexOf(start), src.indexOf('.startHTTP(', src.indexOf(start)));
  for (const start of ["app.use('/mcp-oauth'", 'const bearerRoute =']) {
    expect(src.indexOf(start)).toBeGreaterThan(-1);
    const body = handler(start);
    const refusal = body.indexOf('refuseNonPost(req, res)');
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeGreaterThan(body.search(/oauthMiddleware\(req, res, url\)|resolveAuth\(token\)/));
    expect(refusal).toBeLessThan(body.indexOf('readBody(req, res)'));
  }
});

it('the full and the directory server both stand behind that handler', () => {
  expect(src).toContain("bearerRoute('/mcp', server)");
  expect(src).toContain('bearerRoute(DIRECTORY_PATH, directoryServer, directoryMetadataUrl)');
});
