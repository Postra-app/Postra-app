import sharp from 'sharp';
import { createHash } from 'crypto';
import { applyRetouch } from './retouch.service';
import { pipelineFor, RetouchSpec } from './retouch-spec';

// A small photo-like source: a left-to-right gradient tinted blue, so white
// balance, exposure and mono all have something to act on.
const source = async () => {
  const w = 96;
  const h = 64;
  const raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = Math.round((x / (w - 1)) * 200) + 20;
      raw[i] = Math.round(v * 0.8);
      raw[i + 1] = v;
      raw[i + 2] = Math.min(255, Math.round(v * 1.2));
    }
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg().toBuffer();
};

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const means = async (b: Buffer) =>
  (await sharp(b).stats()).channels.slice(0, 3).map((c) => c.mean);

const zero: RetouchSpec = {
  exposure: 0, contrast: 0, temperature: 0, tint: 0, shadows: 0, saturation: 0, sharpen: 0, summary: '',
};

describe('applyRetouch', () => {
  it('is deterministic: same bytes, same pipeline, same output', async () => {
    const src = await source();
    const p = pipelineFor({ ...zero, exposure: 0.5, shadows: 0.5, sharpen: 0.5 }, 'strong');
    expect(hash(await applyRetouch(src, p))).toBe(hash(await applyRetouch(src, p)));
  });

  it('brightens when asked to and darkens when asked to', async () => {
    const src = await source();
    const base = await means(src);
    const up = await means(await applyRetouch(src, pipelineFor({ ...zero, exposure: 1 }, 'strong')));
    const down = await means(await applyRetouch(src, pipelineFor({ ...zero, exposure: -1 }, 'strong')));
    expect(up[1]).toBeGreaterThan(base[1]);
    expect(down[1]).toBeLessThan(base[1]);
  });

  it('warmer moves red up relative to blue', async () => {
    const src = await source();
    const base = await means(src);
    const warm = await means(await applyRetouch(src, pipelineFor({ ...zero, temperature: 1 }, 'strong')));
    expect(warm[0] / warm[2]).toBeGreaterThan(base[0] / base[2]);
  });

  it('black and white has equal channels', async () => {
    const src = await source();
    const bw = await applyRetouch(src, pipelineFor(zero, 'bw'));
    const [r, g, b] = await means(bw);
    expect(Math.abs(r - g)).toBeLessThan(0.5);
    expect(Math.abs(g - b)).toBeLessThan(0.5);
  });

  it('lifts the shadows: dark pixels come up more than bright ones', async () => {
    const src = await source();
    // against the no-op pipeline, so the auto-levels stretch is in both
    const before = await sharp(await applyRetouch(src, pipelineFor(zero, 'strong'))).raw().toBuffer();
    const after = await sharp(await applyRetouch(src, pipelineFor({ ...zero, shadows: 1 }, 'strong'))).raw().toBuffer();
    // left edge of the gradient is dark, right edge is bright (green channel)
    const w = 96;
    const dark = after[(10 * w + 4) * 3 + 1] - before[(10 * w + 4) * 3 + 1];
    const bright = after[(10 * w + 90) * 3 + 1] - before[(10 * w + 90) * 3 + 1];
    expect(dark).toBeGreaterThan(bright);
    expect(dark).toBeGreaterThan(10);
  });

  it('caps a phone-sized photo to 2048 px on the longest edge', async () => {
    const big = await sharp({ create: { width: 3000, height: 2250, channels: 3, background: '#406080' } }).jpeg().toBuffer();
    const out = await applyRetouch(big, pipelineFor(zero, 'light'));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([2048, 1536]);
  });

  it('keeps the size and comes back as a JPEG', async () => {
    const src = await source();
    const out = await applyRetouch(src, pipelineFor(zero, 'light'));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([96, 64, 'jpeg']);
  });
});
