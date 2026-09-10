import { reusedBackground } from './reused-background';

describe('reusedBackground', () => {
  it('reports a reused single design', () => {
    expect(reusedBackground({ cacheHit: true }, false)).toBe(true);
    expect(reusedBackground({ cacheHit: false }, false)).toBe(false);
  });

  it('claims nothing when the field is missing or the call failed', () => {
    expect(reusedBackground({}, false)).toBe(false);
    expect(reusedBackground(null, false)).toBe(false);
  });

  it('needs every carousel slide to come from cache', () => {
    const mixed = { slides: [{ cacheHit: true }, { cacheHit: false }] };
    expect(reusedBackground(mixed, true)).toBe(false);
    expect(
      reusedBackground({ slides: [{ cacheHit: true }, { cacheHit: true }] }, true)
    ).toBe(true);
  });

  it('does not call an empty carousel a saving', () => {
    expect(reusedBackground({ slides: [] }, true)).toBe(false);
  });
});
