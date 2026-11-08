import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// What Studio stores for a design is bounded: a spec over 200 layers and a
// canvas that is not a Fabric canvas are refused before anything is written,
// so neither can be saved and then break the editor that opens it.
const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('a design over 200 layers, or a canvas that is not one, is refused', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  const id = '00000000-0000-4000-8000-000000000000';
  const layer = (i: number) => ({ id: `l${i}`, type: 'text', text: `${i}` });
  try {
    const spec = (n: number) =>
      org.api.post(`/media/${id}/design-spec`, {
        data: { spec: { version: 1, platform: 'instagram-feed', layers: Array.from({ length: n }, (_, i) => layer(i)) } },
      });
    expect((await spec(201)).status()).toBe(400);
    for (const canvasJson of ['not json', '[]', '{"objects":"x"}']) {
      expect((await org.api.put(`/media/${id}/canvas`, { data: { canvasJson } })).status(), canvasJson).toBe(400);
    }
  } finally {
    await org.remove();
  }
});
