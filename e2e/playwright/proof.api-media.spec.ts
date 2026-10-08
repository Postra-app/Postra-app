import { expect, test } from '@playwright/test';
const PROOF_STATE = `${__dirname}/.auth/proof-c.json`;

test.use({ storageState: PROOF_STATE });

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'proof', version: '0' } },
};
const parse = (text: string) => JSON.parse(text.match(/^data: (.*)$/m)?.[1] ?? text);

// After app #345 on production: GET /public/v1/media with the organisation's
// key returns the five public fields, page=0 is refused, a wrong key is 401;
// MCP with the key lists mediaListTool; MCP with a wrong key is 401.
test('public API media list and MCP on production', async ({ request }) => {
  const self = await (await request.get('/api/user/self')).json();
  const key: string = self.publicApi;
  expect(key, 'API key of the organisation').toBeTruthy();
  const api = (path: string, k = key) => request.get(`/api/public/v1/${path}`, { headers: { authorization: k } });

  const list = await api('media?page=1');
  expect(list.status()).toBe(200);
  const body = (await list.json()) as { pages: number; results: Record<string, unknown>[] };
  console.log(`media: pages=${body.pages}, results=${body.results.length}`);
  for (const item of body.results) {
    expect(Object.keys(item).sort()).toEqual(['createdAt', 'id', 'name', 'originalName', 'path']);
  }
  expect((await api('media?page=0')).status()).toBe(400);
  expect((await api('media?page=1', 'not-a-key')).status()).toBe(401);

  const headers = (k: string, sid?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${k}`,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  expect((await request.post('/api/mcp', { headers: headers('not-a-key'), data: init })).status()).toBe(401);
  const hello = await request.post('/api/mcp', { headers: headers(key), data: init });
  expect(hello.status()).toBe(200);
  const sid = hello.headers()['mcp-session-id'];
  await request.post('/api/mcp', { headers: headers(key, sid), data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  const tools = await request.post('/api/mcp', {
    headers: headers(key, sid),
    data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  const names: string[] = parse(await tools.text()).result.tools.map((t: { name: string }) => t.name);
  console.log(`MCP tools: ${names.length}; mediaListTool: ${names.includes('mediaListTool')}`);
  expect(names).toContain('mediaListTool');
});

test('Help shows the Developers section', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByText('Developers', { exact: true }).first()).toBeAttached();
  for (const question of [
    'How do I use the Postra API?',
    'What is the SDK?',
    'How do I connect an AI assistant (MCP)?',
    'What do webhooks do?',
    'Are the API, MCP and webhooks safe to use?',
  ]) {
    await expect(page.getByText(question, { exact: true }), question).toBeAttached();
  }
});
