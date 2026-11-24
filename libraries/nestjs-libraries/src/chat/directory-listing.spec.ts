import { readFileSync } from 'fs';
import { join } from 'path';
import { NO_PLAN } from './mcp.directory';

const root = join(__dirname, '..', '..', '..', '..');
const nginx = readFileSync(join(root, 'var', 'docker', 'nginx.conf'), 'utf8');
const server = readFileSync(join(__dirname, 'start.mcp.ts'), 'utf8');

// What a directory of connectors checks besides the tools themselves.
describe('the connector as a directory checks it', () => {
  // OpenAI verifies the host by a token at a fixed path. The backend had the
  // route; the proxy in front of it sent the path to the frontend, which
  // answered 404.
  it('passes the domain verification path to the backend', () => {
    expect(server).toContain("app.use('/.well-known/openai-apps-challenge'");
    expect(nginx).toMatch(
      /location = \/\.well-known\/openai-apps-challenge \{\s+proxy_pass http:\/\/127\.0\.0\.1:3000\/\.well-known\/openai-apps-challenge;/
    );
  });

  // A directory forbids promoting plans or upgrades in what a tool answers.
  it('tells a workspace without a plan why it gets no answer, and sells nothing', () => {
    expect(NO_PLAN).toMatch(/no active plan/);
    expect(NO_PLAN).not.toMatch(/upgrade|subscribe|buy|trial|£|\$|https?:/i);
    expect(server).not.toContain('No subscription found');
  });
});
