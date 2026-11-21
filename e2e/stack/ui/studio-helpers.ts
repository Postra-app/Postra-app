import { expect, Page, test } from '@playwright/test';
import sharp from 'sharp';
import { database, throwawayOrg } from '../helpers';
import { watchForErrors } from './ui-helpers';

// Shared by the Studio specs that check what a tool really does to the
// design: the Fabric state the editor keeps in its draft, the pixels on the
// canvas, the files and requests that leave it.

export type FabricObject = Record<string, unknown> & { type: string };
export type Design = {
  canvas: { objects: FabricObject[]; background?: unknown };
  slides?: (string | null)[];
  slideIndex?: number;
  platformKey: string;
};

/** The design as the editor keeps it. pagehide is when the editor writes its
 *  draft outside its 30-second timer; an empty canvas writes nothing. */
export const design = async (page: Page): Promise<Design | null> => {
  const raw = await page.evaluate(() => {
    window.dispatchEvent(new Event('pagehide'));
    const key = Object.keys(localStorage).find(
      (k) => k.startsWith('postra:studio-draft:') && !k.includes(':media:')
    );
    return key ? localStorage.getItem(key) : null;
  });
  if (!raw) return null;
  const draft = JSON.parse(raw);
  return { ...draft, canvas: JSON.parse(draft.canvasJson) };
};

/** One property of the only (or the n-th) object of a type in the design. */
export const prop = async (page: Page, type: string, key: string, n = 0) => {
  const objects = (await design(page))?.canvas.objects ?? [];
  return objects.filter((o) => o.type.toLowerCase() === type)[n]?.[key];
};

export const types = async (page: Page) =>
  ((await design(page))?.canvas.objects ?? []).map((o) => o.type.toLowerCase());

/** RGBA of one point of the drawn canvas, in canvas pixels. Read after two
 *  frames, so the last change has been painted. */
export const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    async ([x, y]) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const c = document.querySelector('canvas.lower-canvas') as HTMLCanvasElement;
      const px = Math.min(c.width - 1, Math.round(x * c.width));
      const py = Math.min(c.height - 1, Math.round(y * c.height));
      return [...c.getContext('2d')!.getImageData(px, py, 1, 1).data];
    },
    [x, y]
  );

/** Mean colourfulness (max - min channel) of the drawn canvas. */
export const colourfulness = (page: Page) =>
  page.evaluate(async () => {
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const c = document.querySelector('canvas.lower-canvas') as HTMLCanvasElement;
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]);
    }
    return sum / (d.length / 4);
  });

export const hex = ([r, g, b]: number[]) =>
  `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** A 640x480 blue photo with a yellow circle in the middle. */
export const photo = () =>
  sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: 40, g: 120, b: 200 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="640" height="480"><circle cx="320" cy="240" r="140" fill="#f5c542"/></svg>'
        ),
      },
    ])
    .jpeg()
    .toBuffer();

/** Studio on a blank canvas; every test ends with `clean()`, which fails on a
 *  console error, a response of 400 or more, or a policy violation. */
export const studio = async (page: Page) => {
  await page.addInitScript(() => {
    (window as any).__violations = [];
    document.addEventListener('securitypolicyviolation', (e) =>
      (window as any).__violations.push(`${e.effectiveDirective} ${e.blockedURI}`)
    );
  });
  const problems = watchForErrors(page);
  page.setDefaultTimeout(15_000);
  await page.goto('/studio');
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /Blank canvas/ }).click();

  const tool = (name: string) => page.getByRole('button', { name, exact: true }).first();
  // The rail buttons toggle their drawer: open one only when it is not on.
  const open = async (name: string) => {
    if ((await tool(name).getAttribute('aria-pressed')) !== 'true') await tool(name).click();
  };
  const layerRows = () =>
    page.locator('div:has(> button[aria-label="Bring forward"]) > button:first-child');
  /** The layer names, front of the design first. */
  const layers = async () => {
    await open('Layers');
    await expect(
      page.getByText(/Top of the list is the front of the design|No layers\. Add text, shape or image first\./)
    ).toBeVisible();
    await page.waitForTimeout(300);
    return layerRows().evaluateAll((rows) => rows.map((r) => r.getAttribute('title') ?? ''));
  };
  /** Selects a layer from the list and waits for the inspector. */
  const select = async (name: string) => {
    await open('Layers');
    await page.getByRole('button', { name, exact: true }).first().click();
    await expect(page.getByText('Selected object', { exact: true })).toBeVisible();
  };
  const addText = async () => {
    await tool('Text').click();
    await expect.poll(() => types(page)).toContain('textbox');
    await select('Type your text');
  };
  const addShape = async (shape: RegExp, type: string) => {
    await open('Shapes');
    await page.getByRole('button', { name: shape }).first().click();
    await expect.poll(async () => (await types(page)).includes(type)).toBe(true);
  };
  const clean = async (allow: (problem: string) => boolean = () => false) => {
    const violations: string[] = await page.evaluate(() => (window as any).__violations);
    expect(
      [...problems, ...violations.map((v) => `csp: ${v}`)]
        // The stack's fake stock photos come over http from localhost.
        .filter((p) => !p.includes('localhost:58080') && !allow(p))
    ).toEqual([]);
  };
  const uploadPhoto = async () => {
    await open('Images');
    const uploaded = page.waitForResponse(
      (r) => r.url().includes('/media/upload-simple') && r.request().method() === 'POST'
    );
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'studio-photo.jpg',
      mimeType: 'image/jpeg',
      buffer: await photo(),
    });
    expect((await uploaded).status()).toBe(201);
    await expect.poll(() => types(page), { timeout: 15_000 }).toContain('image');
  };
  /** Ctrl+Z from a place that is not a field, the way a customer presses it
   *  after clicking a button. */
  const undo = async () => {
    await page.getByTitle('Undo (Ctrl+Z)').focus();
    await page.keyboard.press('ControlOrMeta+z');
  };
  return { tool, open, layers, select, addText, addShape, clean, uploadPhoto, undo, problems };
};

export type Studio = Awaited<ReturnType<typeof studio>>;

/** Every test in the calling describe runs in its own organisation: uploads
 *  count against an organisation's limit and the brand kit and templates are
 *  the organisation's, so they must not be changed under the other specs. */
export const inOwnOrganisation = () => {
  let done: () => Promise<void> = async () => undefined;
  test.beforeEach(async ({ context }) => {
    const prisma = database();
    const org = await throwawayOrg(prisma, { tier: 'PRO', totalChannels: 5, channels: 0 });
    await context.clearCookies();
    await context.addCookies((await org.api.storageState()).cookies);
    done = async () => {
      await org.remove();
      await prisma.$disconnect();
    };
  });
  test.afterEach(async () => {
    await done();
  });
};
