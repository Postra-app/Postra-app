import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// Removing the logo from the Brand Kit has to stick: the panel sends
// logoPath: null, and a null that was dropped on the way kept the old logo in
// every AI design.
const prisma = database();
test.afterAll(() => prisma.$disconnect());

test('a removed Brand Kit logo stays removed, the colours stay', async () => {
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 6, channels: 0 });
  try {
    const put = (data: object) => org.api.put('/brand-kit', { data });
    expect((await put({ logoPath: '/uploads/logo.png', primaryColor: '#ff0066' })).ok()).toBe(true);
    expect((await (await org.api.get('/brand-kit')).json()).logoPath).toBe('/uploads/logo.png');

    expect((await put({ logoPath: null, primaryColor: '#ff0066' })).ok()).toBe(true);
    const kit = await (await org.api.get('/brand-kit')).json();
    expect(kit.logoPath).toBeNull();
    expect(kit.primaryColor).toBe('#ff0066');
  } finally {
    await org.remove();
  }
});
