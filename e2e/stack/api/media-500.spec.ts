import { expect, request, test } from '@playwright/test';
import { BACKEND_URL, database, signedIn } from '../helpers';
import { USERS } from '../seed';

// A library of 500 files: the Media page and the public API page through it
// quickly, every page has its 18 files, the last one the rest, and nothing
// is listed twice or left out.

const prisma = database();
const FILES = 500;
const PER_PAGE = 18;

test.afterAll(() => prisma.$disconnect());

test('a library of 500 files pages quickly and completely', async () => {
  const org = await prisma.organization.findFirstOrThrow({ where: { apiKey: USERS.a.apiKey } });
  const tag = `stack-media-500-${Date.now()}`;
  const start = Date.now() - FILES * 1000;
  await prisma.media.createMany({
    data: Array.from({ length: FILES }, (_, i) => ({
      organizationId: org.id,
      name: `${tag}-${i}.png`,
      originalName: `${tag}-${i}.png`,
      path: `https://cdn.example/${tag}-${i}.png`,
      fileSize: 1000,
      createdAt: new Date(start + i * 1000),
    })),
  });
  const publicApi = await request.newContext({
    baseURL: `${BACKEND_URL}/public/v1/`,
    extraHTTPHeaders: { authorization: USERS.a.apiKey },
  });
  const app = await signedIn('a');
  try {
    const pages = Math.ceil(FILES / PER_PAGE);
    const seen = new Set<string>();
    for (let page = 1; page <= pages; page++) {
      const t0 = Date.now();
      const res = await publicApi.get(`media?search=${tag}&page=${page}`);
      const took = Date.now() - t0;
      expect(res.status(), await res.text()).toBe(200);
      const body = await res.json();
      expect(body.pages).toBe(pages);
      expect(body.results.length).toBe(page < pages ? PER_PAGE : FILES - PER_PAGE * (pages - 1));
      body.results.forEach((m: { id: string }) => seen.add(m.id));
      expect(took, `page ${page} took ${took} ms`).toBeLessThan(1000);
    }
    expect(seen.size).toBe(FILES);

    // The Media page asks the dashboard route for the newest files first;
    // filtered by this test's files, as other specs add media to A meanwhile.
    const t0 = Date.now();
    const res = await app.get(`/media?page=1&search=${tag}`);
    const took = Date.now() - t0;
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json();
    expect(body.pages).toBe(pages);
    expect(body.results[0].name).toBe(`${tag}-${FILES - 1}.png`);
    expect(took, `dashboard page took ${took} ms`).toBeLessThan(1000);
  } finally {
    await prisma.media.deleteMany({ where: { organizationId: org.id, name: { startsWith: tag } } });
    await publicApi.dispose();
    await app.dispose();
  }
});
