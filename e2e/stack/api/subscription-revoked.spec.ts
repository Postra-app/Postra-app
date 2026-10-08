import { expect, request as pwRequest, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';

// E2E-07-32: a revoked subscription is soft-deleted (deletedAt), but the
// organisation loaded for a request (session, API key, MCP) still carried it:
// the permission guard said FREE while /user/self, the public API and MCP
// went on as if the plan were there.

const prisma = database();
test.afterAll(async () => {
  await prisma.$disconnect();
});

test('after a revoke the app, the public API and MCP see no plan', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const api = await pwRequest.newContext({ baseURL: BACKEND_URL });
  try {
    // As revokeSubscription does it (it also clears the 30-second auth cache,
    // so nothing here may load the session before).
    expect((await prisma.subscription.findFirstOrThrow({ where: { organizationId: org.orgId } })).subscriptionTier).toBe('PRO');
    await prisma.subscription.updateMany({ where: { organizationId: org.orgId }, data: { deletedAt: new Date() } });

    expect((await (await org.api.get('/user/self')).json()).tier).toBe('FREE');
    const listed = ((await (await org.api.get('/user/organizations')).json()) as { id: string; subscription: unknown }[]).find(
      (o) => o.id === org.orgId
    )!;
    expect(listed.subscription).toBeNull();
    expect((await api.get('/public/v1/integrations', { headers: { authorization: apiKey! } })).status()).toBe(401);
    const mcp = await api.post('/mcp', {
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${apiKey}` },
      data: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } } },
    });
    expect(mcp.status()).toBe(401);
  } finally {
    await api.dispose();
    await org.remove();
  }
});
