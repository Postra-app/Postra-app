import { moveTrimEdge } from './trim-edges';

describe('moveTrimEdge', () => {
  it('moves an edge and keeps a tenth of a second between them', () => {
    expect(moveTrimEdge('start', 1.2, { start: 0, end: 2 }, 2)).toEqual({ start: 1.2, end: 2 });
    expect(moveTrimEdge('start', 5, { start: 0, end: 2 }, 2).start).toBeCloseTo(1.9);
    expect(moveTrimEdge('end', 0, { start: 0.5, end: 2 }, 2).end).toBeCloseTo(0.6);
  });

  it('never leaves the clip', () => {
    expect(moveTrimEdge('start', -3, { start: 1, end: 2 }, 2).start).toBe(0);
    expect(moveTrimEdge('end', 9, { start: 0, end: 1 }, 2).end).toBe(2);
  });

  it('keeps a clip shorter than the gap inside its own length', () => {
    // A one-frame clip: Home on Start gave -0.06, Home on End gave 0.1.
    const short = { start: 0, end: 0.04 };
    const s = moveTrimEdge('start', 0, short, 0.04);
    expect(s.start).toBeGreaterThanOrEqual(0);
    expect(s.start).toBeLessThan(s.end);
    const e = moveTrimEdge('end', 0.04, short, 0.04);
    expect(e.end).toBeLessThanOrEqual(0.04);
    expect(e.end).toBeGreaterThan(e.start);
  });
});
