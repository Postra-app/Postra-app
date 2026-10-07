import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, throwawayOrg } from '../helpers';
import { USERS } from '../seed';

// GET /public/v1/media and the agent's mediaListTool (upstream 5cd4de2f with
// its fixes 063ee509, 4be38e1a, e7b8126b, dda966e4): the organisation's own
// media only, the media's own fields only, and a page that is checked.

const OWN_FIELDS = ['createdAt', 'id', 'name', 'originalName', 'path'];
const prisma = database();

test.afterAll(() => prisma.$disconnect());

test('public API lists the own media library, media fields only', async () => {
  const orgA = await prisma.organization.findFirstOrThrow({ where: { apiKey: USERS.a.apiKey } });
  const orgB = await prisma.organization.findFirstOrThrow({ where: { apiKey: USERS.b.apiKey } });
  const tag = `stack-media-list-${Date.now()}`;
  const mine = await prisma.media.create({
    data: { organizationId: orgA.id, name: `${tag}-a.png`, originalName: `${tag}-a.png`, path: `https://cdn.example/${tag}-a.png`, alt: 'secret alt', thumbnail: 'https://cdn.example/t.png', aiGenerated: true },
  });
  const theirs = await prisma.media.create({
    data: { organizationId: orgB.id, name: `${tag}-b.png`, originalName: `${tag}-b.png`, path: `https://cdn.example/${tag}-b.png` },
  });
  const api = await request.newContext({ baseURL: `${BACKEND_URL}/public/v1/`, extraHTTPHeaders: { authorization: USERS.a.apiKey } });
  const anonymous = await request.newContext({ baseURL: `${BACKEND_URL}/public/v1/` });
  try {
    const res = await api.get(`media?search=${tag}`);
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.results.map((m: { id: string }) => m.id)).toEqual([mine.id]);
    expect(Object.keys(body.results[0]).sort()).toEqual(OWN_FIELDS);
    expect(body.pages).toBe(1);

    for (const page of ['0', '-1', 'abc']) {
      expect((await api.get(`media?page=${page}`)).status(), `page=${page}`).toBe(400);
    }
    expect((await anonymous.get('media')).status()).toBe(401);
  } finally {
    await prisma.media.deleteMany({ where: { id: { in: [mine.id, theirs.id] } } });
    await api.dispose();
    await anonymous.dispose();
  }
});

const init = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'stack', version: '0' } },
};
const parse = (text: string) => JSON.parse(text.match(/^data: (.*)$/m)?.[1] ?? text);

test('MCP mediaListTool returns the own media with media fields only', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const { apiKey } = await prisma.organization.findUniqueOrThrow({ where: { id: org.orgId } });
  const media = await prisma.media.create({
    data: { organizationId: org.orgId, name: 'tool.png', originalName: 'tool-original.png', path: 'https://cdn.example/tool.png', alt: 'secret alt' },
  });
  const api = await request.newContext({ baseURL: BACKEND_URL });
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
    const call = await api.post('/mcp', {
      headers: headers(sid),
      data: { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'mediaListTool', arguments: { search: 'tool-original' } } },
    });
    expect(call.status()).toBe(200);
    const result = parse(await call.text()).result;
    const out = result.structuredContent ?? JSON.parse(result.content[0].text);
    expect(out.output.map((m: { id: string }) => m.id)).toEqual([media.id]);
    expect(Object.keys(out.output[0]).sort()).toEqual(OWN_FIELDS);
  } finally {
    await api.dispose();
    await org.remove();
  }
});
