import { isAllowedDynamicRedirect } from '@gitroom/nestjs-libraries/dtos/oauth/dynamic-redirect';

// Dynamic client registration (upstream eabac3d3d, 0d8d0f228) with our
// allowlist: anyone may register a client, so the address a code is sent to
// must be one of the assistants we know, or the person's own computer.
describe('redirect addresses a dynamic OAuth client may register', () => {
  const hosts = ['claude.ai', 'chatgpt.com'];

  it('takes the assistants on https, and localhost on any port for local MCP clients', () => {
    for (const ok of [
      'https://claude.ai/api/mcp/auth_callback',
      'https://chatgpt.com/connector_platform_oauth_redirect',
      'http://localhost:33418/callback',
      'http://127.0.0.1:6274/oauth/callback',
    ]) {
      expect(isAllowedDynamicRedirect(ok, hosts)).toBe(true);
    }
  });

  it('refuses anywhere else, look-alikes, plain http on the internet, userinfo and fragments', () => {
    for (const bad of [
      'https://evil.example/callback',
      'https://claude.ai.evil.example/cb',
      'https://evilclaude.ai/cb',
      'http://claude.ai/api/mcp/auth_callback',
      'https://user:pw@claude.ai/cb',
      'https://claude.ai/cb#frag',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isAllowedDynamicRedirect(bad, hosts)).toBe(false);
    }
  });
});
