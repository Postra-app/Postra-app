import { expect, request, test } from '@playwright/test';
import { BACKEND_URL } from '../helpers';
import { USERS } from '../seed';

// E2E-08-60: ChatGPT and Claude used to reach MCP with the API key in the
// address (/mcp/<key>, /sse/<key>, /message/<key>), so the key landed in the
// ALB and WAF logs, the assistant's logs and browser history. They sign in by
// OAuth now (/mcp-oauth, proven on prod 10-08), other clients send the key in
// the Authorization header, and the key-in-path routes are gone.

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } },
};
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };

test('a valid key in the address no longer reaches MCP', async () => {
  const api = await request.newContext({ baseURL: BACKEND_URL });
  try {
    const key = USERS.a.apiKey;
    expect((await api.post(`/mcp/${key}`, { headers, data: init })).status(), 'POST /mcp/:key').toBe(404);
    expect((await api.get(`/sse/${key}`, { headers: { accept: 'text/event-stream' }, timeout: 10_000 })).status(), 'GET /sse/:key').toBe(404);
    expect((await api.post(`/message/${key}`, { headers, data: init })).status(), 'POST /message/:key').toBe(404);
    // The same key in the header still works.
    const bearer = await api.post('/mcp', { headers: { ...headers, authorization: `Bearer ${key}` }, data: init });
    expect(bearer.status(), await bearer.text()).toBe(200);
  } finally {
    await api.dispose();
  }
});
