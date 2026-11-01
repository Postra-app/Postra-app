import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// The MCP server (Settings → Developers) had no test at all. Its handlers are
// raw Express routes outside Nest's ThrottlerGuard, so the per-organisation
// limit (120 requests / 5 min) is all that stops an API key from looping the
// agent's toolset.

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } },
};
const parse = (text: string) => JSON.parse(text.match(/^data: (.*)$/m)?.[1] ?? text);

test('MCP: handshake, tools and the per-organisation limit', async () => {
  test.setTimeout(120_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const { apiKey } = (await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } }))!;
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  const headers = (key: string, sid?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${key}`,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  try {
    expect((await api.post('/mcp', { headers: headers('not-a-key'), data: init })).status()).toBe(401);

    const hello = await api.post('/mcp', { headers: headers(apiKey!), data: init });
    expect(hello.status()).toBe(200);
    expect(parse(await hello.text()).result.serverInfo.name).toBe('Postra MCP');
    const sid = hello.headers()['mcp-session-id'];
    await api.post('/mcp', { headers: headers(apiKey!, sid), data: { jsonrpc: '2.0', method: 'notifications/initialized' } });

    const list = await api.post('/mcp', {
      headers: headers(apiKey!, sid),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    });
    const names = parse(await list.text()).result.tools.map((t: { name: string }) => t.name);
    expect(names).toEqual(expect.arrayContaining(['integrationList', 'integrationSchedulePostTool', 'ask_postra']));

    // 3 requests so far; the 121st in the window is refused.
    const statuses: number[] = [];
    for (let i = 4; i <= 122; i++) {
      const res = await api.post('/mcp', {
        headers: headers(apiKey!, sid),
        data: { jsonrpc: '2.0', id: i, method: 'tools/list' },
      });
      statuses.push(res.status());
    }
    expect(statuses.indexOf(429) + 4).toBe(121);
    expect(statuses.slice(-1)[0]).toBe(429);
  } finally {
    await api.dispose();
    await org.remove();
    await prisma.$disconnect();
  }
});

// integrationList says it lists the channels posts can go to, but it gave
// disabled ones too, and its output schema drops "disabled", so the assistant
// could not tell them apart and offered a channel nothing publishes to.
test('MCP integrationList leaves out disabled channels', async () => {
  test.setTimeout(60_000);
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 2 });
  const [on, off] = org.channelIds;
  await prisma.integration.update({ where: { id: off }, data: { disabled: true } });
  const { apiKey } = (await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } }))!;
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  const headers = (sid?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${apiKey}`,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  try {
    const hello = await api.post('/mcp', { headers: headers(), data: init });
    const sid = hello.headers()['mcp-session-id'];
    await api.post('/mcp', { headers: headers(sid), data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
    const res = await api.post('/mcp', {
      headers: headers(sid),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'integrationList', arguments: {} } },
    });
    expect(res.status(), await res.text()).toBe(200);
    const result = parse(await res.text()).result;
    const ids = (result.structuredContent ?? JSON.parse(result.content[0].text)).output.map(
      (c: { id: string }) => c.id
    );
    expect(ids).toContain(on);
    expect(ids).not.toContain(off);
  } finally {
    await api.dispose();
    await org.remove();
    await prisma.$disconnect();
  }
});
