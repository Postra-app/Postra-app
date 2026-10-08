import { APIRequestContext, expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// E2E-08-47: the agent asked through MCP (`ask_postra`) ran outside the
// organisation's monthly allowance (`agent_tokens`): its usage was recorded
// with no organisation, and the budget check never knew whose run it was.
// The fake OpenAI answers the Responses API the agent's model uses.

const FAKE = 'http://localhost:58090';
const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } },
};
const parse = (text: string) => JSON.parse(text.match(/^data: (.*)$/m)?.[1] ?? text);

const mcpSession = async (api: APIRequestContext, key: string) => {
  const headers = (sid?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${key}`,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  const hello = await api.post('/mcp', { headers: headers(), data: init });
  expect(hello.status()).toBe(200);
  const sid = hello.headers()['mcp-session-id'];
  await api.post('/mcp', { headers: headers(sid), data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  return (message: string) =>
    api.post('/mcp', {
      headers: headers(sid),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ask_postra', arguments: { message } } },
      timeout: 60_000,
    });
};

const seen = async (text: string) =>
  ((await (await fetch(`${FAKE}/__seen?text=${encodeURIComponent(text)}`)).json()) as { count: number }).count;

test('the agent asked through MCP is metered to the organisation', async () => {
  test.setTimeout(90_000);
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  try {
    const ask = await mcpSession(api, apiKey!);
    const marker = `mcp-metered-${Date.now()}`;
    const res = await ask(`Say hello (${marker})`);
    expect(res.status(), await res.text()).toBe(200);
    expect(await seen(marker)).toBeGreaterThan(0);
    // The organisation's prompt cache key goes with the call (OpenAI keeps one
    // org's turns in one cache).
    expect(await seen(`"prompt_cache_key":"postra-agent-${org.orgId}"`)).toBeGreaterThan(0);
    await expect
      .poll(() => prisma.aiUsage.count({ where: { organizationId: org.orgId, engine: 'agent' } }))
      .toBeGreaterThan(0);
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.orgId } });
    await api.dispose();
    await org.remove();
  }
});

test('an organisation past its agent allowance gets no agent run through MCP', async () => {
  test.setTimeout(90_000);
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  // Pro allows 4M weighted tokens a month.
  await prisma.aiUsage.create({
    data: { organizationId: org.orgId, engine: 'agent', model: 'gpt-5.5', inputAmount: 5_000_000 },
  });
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  try {
    const ask = await mcpSession(api, apiKey!);
    const marker = `mcp-over-budget-${Date.now()}`;
    const res = await ask(`Say hello (${marker})`);
    expect(res.status(), await res.text()).toBe(200);
    const answer = parse(await res.text());
    expect(answer.result?.isError).toBe(true);
    expect(JSON.stringify(answer.result?.content)).toContain('monthly AI assistant limit');
    expect(await seen(marker)).toBe(0);
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.orgId } });
    await api.dispose();
    await org.remove();
  }
});
