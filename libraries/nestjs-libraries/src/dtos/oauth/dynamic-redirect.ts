/**
 * Where a dynamically registered OAuth client (an AI assistant connecting to
 * Postra's MCP server) may have its authorization code sent. Anyone can
 * register a client, so an open list would let a stranger dress up a
 * "Claude" client, send a person to Postra's consent screen and collect the
 * code on their own server. Allowed: https on the assistants we know
 * (OAUTH_DYNAMIC_REDIRECT_HOSTS, default claude.ai and chatgpt.com, and
 * their subdomains), and http on the person's own computer (localhost,
 * 127.0.0.1) for local MCP clients (upstream 0d8d0f228).
 */
export const DEFAULT_DYNAMIC_REDIRECT_HOSTS = ['claude.ai', 'chatgpt.com'];

export const dynamicRedirectHosts = (): string[] => {
  const configured = (process.env.OAUTH_DYNAMIC_REDIRECT_HOSTS || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_DYNAMIC_REDIRECT_HOSTS;
};

export const isAllowedDynamicRedirect = (
  value: string,
  hosts: string[] = dynamicRedirectHosts()
): boolean => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') {
    return host === 'localhost' || host === '127.0.0.1';
  }
  if (url.protocol !== 'https:') return false;
  return hosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
};
