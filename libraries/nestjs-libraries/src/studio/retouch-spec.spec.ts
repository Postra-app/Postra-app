import {
  LEVEL_REACH,
  RETOUCH_LEVELS,
  clampSpec,
  describeSpec,
  heuristicSpec,
  pipelineFor,
  RetouchSpec,
} from './retouch-spec';

const wild: RetouchSpec = {
  exposure: 9,
  contrast: -9,
  temperature: 2,
  tint: -2,
  shadows: 5,
  saturation: 3,
  sharpen: 7,
  summary: 'Brightened it — a lot – really',
};

describe('clampSpec', () => {
  it.each(RETOUCH_LEVELS)('%s caps every control to its reach', (level) => {
    const s = clampSpec(wild, level);
    const reach = LEVEL_REACH[level];
    expect(s.exposure).toBe(reach);
    expect(s.contrast).toBe(-reach);
    expect(s.temperature).toBe(reach);
    expect(s.tint).toBe(-reach);
    expect(s.shadows).toBe(reach);
    expect(s.sharpen).toBe(reach);
    expect(s.saturation).toBe(level === 'bw' ? 0 : reach);
  });

  it('light moves less than strong', () => {
    expect(LEVEL_REACH.light).toBeLessThan(LEVEL_REACH.medium);
    expect(LEVEL_REACH.medium).toBeLessThan(LEVEL_REACH.strong);
  });

  it('strips long dashes and bounds the summary', () => {
    const s = clampSpec(wild, 'light');
    expect(s.summary).not.toMatch(/[–—]/);
    expect(clampSpec({ ...wild, summary: 'x'.repeat(500) }, 'light').summary).toHaveLength(240);
  });

  it('treats NaN and missing values as "leave it"', () => {
    const s = clampSpec({ ...wild, exposure: Number.NaN, summary: undefined as never }, 'medium');
    expect(s.exposure).toBe(0);
    expect(s.summary).toBe('');
  });
});

describe('pipelineFor', () => {
  const zero: RetouchSpec = {
    exposure: 0, contrast: 0, temperature: 0, tint: 0, shadows: 0, saturation: 0, sharpen: 0, summary: '',
  };

  it('all zeros is a no-op pipeline (only the gentle stretch)', () => {
    const p = pipelineFor(zero, 'strong');
    expect(p.gain).toEqual([1, 1, 1]);
    expect(p.contrast).toBe(1);
    expect(p.claheSlope).toBe(0);
    expect(p.saturation).toBe(1);
    expect(p.sharpenSigma).toBe(0);
    expect(p.mono).toBe(false);
  });

  it('warmer raises red and lowers blue by the same amount', () => {
    const p = pipelineFor({ ...zero, temperature: 1 }, 'strong');
    expect(p.gain[0]).toBeGreaterThan(1);
    expect(p.gain[2]).toBeLessThan(1);
    expect(p.gain[0] - 1).toBeCloseTo(1 - p.gain[2], 5);
    expect(p.gain[1]).toBe(1);
  });

  it('the same intent goes further at a stronger level', () => {
    const light = pipelineFor({ ...zero, exposure: 1 }, 'light');
    const strong = pipelineFor({ ...zero, exposure: 1 }, 'strong');
    expect(light.gain[0]).toBeCloseTo(1 + 0.35 * 0.35, 3);
    expect(strong.gain[0]).toBeCloseTo(1.35, 3);
  });

  it('black and white is mono with no saturation move', () => {
    const p = pipelineFor({ ...zero, saturation: 1 }, 'bw');
    expect(p.mono).toBe(true);
    expect(p.saturation).toBe(1);
  });

  it('shadows switch CLAHE on with an integer slope', () => {
    expect(pipelineFor({ ...zero, shadows: 0.05 }, 'strong').claheSlope).toBe(0);
    const p = pipelineFor({ ...zero, shadows: 1 }, 'strong');
    expect(Number.isInteger(p.claheSlope)).toBe(true);
    expect(p.claheSlope).toBe(3);
  });
});

describe('heuristicSpec', () => {
  it('brightens a dark photo and darkens a bright one', () => {
    expect(heuristicSpec({ means: [40, 40, 40] }, 'strong').exposure).toBeGreaterThan(0.3);
    expect(heuristicSpec({ means: [230, 230, 230] }, 'strong').exposure).toBeLessThan(-0.3);
  });

  it('only nudges the white balance, even on a strongly blue photo', () => {
    const s = heuristicSpec({ means: [120, 160, 240] }, 'strong');
    expect(s.temperature).toBeGreaterThan(0);
    expect(s.temperature).toBeLessThanOrEqual(0.25);
    expect(pipelineFor(s, 'strong').gain[0] / pipelineFor(s, 'strong').gain[2]).toBeLessThan(1.1);
  });

  it('stays inside the level', () => {
    const s = heuristicSpec({ means: [10, 10, 10] }, 'light');
    expect(s.exposure).toBeLessThanOrEqual(LEVEL_REACH.light);
    expect(s.shadows).toBe(0);
  });
});

describe('describeSpec', () => {
  it('reads the numbers out as a sentence', () => {
    const text = describeSpec(
      { exposure: 0.3, contrast: 0, temperature: -0.2, tint: 0, shadows: 0.4, saturation: 0, sharpen: 0, summary: '' },
      'bw'
    );
    expect(text).toBe('Brightened slightly, cooled the colours, lifted the shadows, converted to black and white.');
  });

  it('says so when nothing moved', () => {
    expect(
      describeSpec({ exposure: 0, contrast: 0, temperature: 0, tint: 0, shadows: 0, saturation: 0, sharpen: 0, summary: '' }, 'light')
    ).toMatch(/Already well balanced/);
  });
});
