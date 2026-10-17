import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// The MCP server no longer takes the API key in its path: CLI clients send it
// in the Authorization header and ChatGPT/Claude sign in by OAuth at
// /mcp-oauth. A key in a URL lands in proxy logs, browser history and
// screenshots, so no client config the app shows may build `/mcp/<key>`.

const root = join(__dirname, '..', '..', '..', '..');
const frontend = join(root, 'apps', 'frontend', 'src');

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return sources(path);
    }
    return /\.tsx?$/.test(name) && !/\.spec\.tsx?$/.test(name) ? [path] : [];
  });

describe('MCP client configs', () => {
  it('never put the API key in the MCP path', () => {
    const offenders = sources(frontend).filter((path) =>
      /\/mcp\/\$\{/.test(readFileSync(path, 'utf8'))
    );
    expect(offenders).toEqual([]);
  });
});
