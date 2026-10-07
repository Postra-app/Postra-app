import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// The public API turned an organisation without a subscription away; the MCP
// server checked only the key, so a cancelled organisation kept reading its
// channels, posts, analytics and media through MCP. Every way in is refused.

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } },
};

test('no subscription: MCP and the public API refuse the key', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  await prisma.subscription.deleteMany({ where: { organizationId: org.orgId } });
  const api = await request.newContext({ baseURL: BACKEND_URL });
  const mcpHeaders = (extra = {}) => ({
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  });
  try {
    const bearer = await api.post('/mcp', { headers: mcpHeaders({ authorization: `Bearer ${apiKey}` }), data: init });
    expect(bearer.status(), 'POST /mcp').toBe(401);
    const inPath = await api.post(`/mcp/${apiKey}`, { headers: mcpHeaders(), data: init });
    expect(inPath.status(), 'POST /mcp/:key').toBe(401);
    const sse = await api.get(`/sse/${apiKey}`, { headers: { accept: 'text/event-stream' }, timeout: 10_000 });
    expect(sse.status(), 'GET /sse/:key').toBe(401);
    const rest = await api.get('/public/v1/is-connected', { headers: { authorization: apiKey! } });
    expect(rest.status(), 'public API').toBe(401);
  } finally {
    await api.dispose();
    await org.remove();
    await prisma.$disconnect();
  }
});
