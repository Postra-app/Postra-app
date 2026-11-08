import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { database } from '../helpers';
import { USERS } from '../seed';

// A chat is titled after its first answer. Until then its entry in the chat
// list was a link with no text, so a screen reader announced only "link"
// (axe link-name, seen in Firefox when a chat was still untitled).
test('an untitled chat in the list still has a name', async ({ page }) => {
  const prisma = database();
  const org = await prisma.organization.findFirstOrThrow({ where: { name: USERS.a.org } });
  const id = randomUUID();
  const at = new Date('2026-03-04T10:05:00Z');
  await prisma.$executeRaw`INSERT INTO mastra_threads (id, "resourceId", title, metadata, "createdAt", "updatedAt") VALUES (${id}, ${org.id}, '', NULL, ${at}, ${at})`;
  try {
    await page.goto('/agents');
    const link = page.locator(`a[href="/agents/${id}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAccessibleName(/\S/);
    await expect(link).toContainText('2026');
  } finally {
    await prisma.$executeRaw`DELETE FROM mastra_threads WHERE id = ${id}`;
    await prisma.$disconnect();
  }
});
