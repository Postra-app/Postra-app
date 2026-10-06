import { publicBackendUrl } from './public-backend-url';

// E2E-08-45: the MCP resource was advertised as https://app.postra.pl/mcp-oauth
// while clients connect to https://app.postra.pl/api/mcp-oauth.
describe('publicBackendUrl', () => {
  const env = process.env.NEXT_PUBLIC_BACKEND_URL;
  afterAll(() => (process.env.NEXT_PUBLIC_BACKEND_URL = env));

  it('keeps the path of the backend URL', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'https://app.postra.pl/api';
    expect(publicBackendUrl('/mcp-oauth')).toBe('https://app.postra.pl/api/mcp-oauth');
    expect(new URL('/mcp-oauth', process.env.NEXT_PUBLIC_BACKEND_URL).toString()).toBe(
      'https://app.postra.pl/mcp-oauth'
    );
  });

  it('does not double a trailing slash', () => {
    process.env.NEXT_PUBLIC_BACKEND_URL = 'http://localhost:3000/';
    expect(publicBackendUrl('/mcp-oauth')).toBe('http://localhost:3000/mcp-oauth');
  });
});
