import { expect, test } from '@playwright/test';
import { database, throwawayOrg } from '../helpers';

// "Post now" pressed while a photo was still uploading sent the post without
// it, and Instagram refused it at publishing time ("Should have at least one
// media") — a failed post the customer only learned about later. The
// composer waits for uploads now; the server must also refuse, on its own, a
// post that a platform cannot publish without media, before anything is
// stored or scheduled.
test('a post Instagram needs media for is refused up front when it arrives without any', async () => {
  const prisma = database();
  const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 1, provider: 'instagram' });
  try {
    const content = `[stack] no media ${Date.now()}`;
    for (const type of ['now', 'schedule'] as const) {
      const res = await org.api.post('/posts', {
        data: {
          type,
          shortLink: false,
          date: new Date(Date.now() + 3_600_000).toISOString(),
          tags: [],
          posts: [
            {
              integration: { id: org.channelIds[0] },
              value: [{ content, image: [] }],
              settings: { __type: 'instagram', post_type: 'post' },
            },
          ],
        },
      });
      expect(res.status(), await res.text()).toBe(400);
      expect(await res.text()).toContain('at least one media');
    }
    expect(await prisma.post.count({ where: { organizationId: org.orgId } }), 'nothing stored').toBe(0);

    // A draft may still be saved without media; the check runs when it is scheduled.
    const draft = await org.api.post('/posts', {
      data: {
        type: 'draft',
        shortLink: false,
        date: new Date(Date.now() + 3_600_000).toISOString(),
        tags: [],
        posts: [
          {
            type: 'draft',
            integration: { id: org.channelIds[0] },
            value: [{ content, image: [] }],
            settings: { __type: 'instagram', post_type: 'post' },
          },
        ],
      },
    });
    expect(draft.status(), await draft.text()).toBe(201);
  } finally {
    await org.remove();
    await prisma.$disconnect();
  }
});
