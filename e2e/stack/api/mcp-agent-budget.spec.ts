import { APIRequestContext, expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// E2E-08-47: the agent asked through MCP (`ask_postra`) ran outside the
// organisation's monthly allowance (now `agent_messages`): its usage was recorded
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
    // One question is one message of the monthly fair use.
    await expect
      .poll(() =>
        prisma.aiUsage.count({ where: { organizationId: org.orgId, engine: 'agent', unit: 'messages' } })
      )
      .toBe(1);
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
  // Every plan's fair use is 2200 assistant messages a month.
  await prisma.aiUsage.createMany({
    data: Array.from({ length: 2200 }, () => ({
      organizationId: org.orgId,
      engine: 'agent',
      model: 'message',
      unit: 'messages',
      inputAmount: 1,
    })),
  });
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  try {
    const ask = await mcpSession(api, apiKey!);
    const marker = `mcp-over-budget-${Date.now()}`;
    const res = await ask(`Say hello (${marker})`);
    expect(res.status(), await res.text()).toBe(200);
    const answer = parse(await res.text());
    expect(answer.result?.isError).toBe(true);
    expect(JSON.stringify(answer.result?.content)).toContain('fair-use limit for the AI assistant');
    expect(await seen(marker)).toBe(0);
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.orgId } });
    await api.dispose();
    await org.remove();
  }
});

// CodeQL on #348: the questions of a JSON-RPC batch were counted one write
// each, and every ask_postra in a batch is a whole agent run while the MCP
// rate limit counts requests. A batch is now at most 5 questions, counted
// in one write.
test('a batch of questions is capped at 5 and counted in one write', async () => {
  test.setTimeout(90_000);
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  const headers = (sid?: string) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${apiKey}`,
    ...(sid ? { 'mcp-session-id': sid } : {}),
  });
  const ask = (id: number, marker: string) => ({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name: 'ask_postra', arguments: { message: `Say hello (${marker})` } },
  });
  try {
    const hello = await api.post('/mcp', { headers: headers(), data: init });
    const sid = hello.headers()['mcp-session-id'];
    await api.post('/mcp', { headers: headers(sid), data: { jsonrpc: '2.0', method: 'notifications/initialized' } });

    const tooMany = `mcp-batch-6-${Date.now()}`;
    const refused = await api.post('/mcp', {
      headers: headers(sid),
      data: Array.from({ length: 6 }, (_, i) => ask(10 + i, tooMany)),
    });
    expect(refused.status()).toBe(200);
    const answers = JSON.parse(await refused.text());
    expect(answers).toHaveLength(6);
    for (const a of answers) {
      expect(a.result?.isError).toBe(true);
      expect(JSON.stringify(a.result?.content)).toContain('at most 5');
    }
    expect(await seen(tooMany)).toBe(0);

    const two = `mcp-batch-2-${Date.now()}`;
    await api.post('/mcp', { headers: headers(sid), data: [ask(20, two), ask(21, two)], timeout: 60_000 });
    await expect
      .poll(async () =>
        (
          await prisma.aiUsage.aggregate({
            where: { organizationId: org.orgId, engine: 'agent', unit: 'messages' },
            _sum: { inputAmount: true },
            _count: { _all: true },
          })
        )
      )
      .toMatchObject({ _sum: { inputAmount: 2 }, _count: { _all: 1 } });
  } finally {
    await prisma.aiUsage.deleteMany({ where: { organizationId: org.orgId } });
    await api.dispose();
    await org.remove();
  }
});
