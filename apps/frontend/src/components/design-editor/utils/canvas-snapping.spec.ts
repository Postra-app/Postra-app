import { computeSnap, edgesOf } from './canvas-snapping';

const artboard = { width: 1000, height: 800 };

describe('computeSnap', () => {
  it('does nothing when nothing is within the threshold', () => {
    // deliberately off every artboard edge and centre line too - the artboard
    // is always a snap target, which is what makes centring feel right
    const moving = edgesOf(311, 233, 90, 44);
    const result = computeSnap(moving, [edgesOf(700, 600, 30, 30)], artboard, 6);
    expect(result).toEqual({ dx: 0, dy: 0, guides: [] });
  });

  it('pulls a left edge onto another object left edge', () => {
    const moving = edgesOf(103, 300, 100, 50);
    const other = edgesOf(100, 0, 40, 40);
    const { dx, guides } = computeSnap(moving, [other], artboard, 6);
    expect(dx).toBe(-3);
    expect(guides).toContainEqual({ axis: 'x', at: 100 });
  });

  it('snaps to the centre of the artboard even with nothing else around', () => {
    // 100 wide, so a centre of 500 means a left edge of 450
    const moving = edgesOf(452, 300, 100, 50);
    const { dx } = computeSnap(moving, [], artboard, 6);
    expect(dx).toBe(-2);
  });

  it('takes the nearest candidate when several are in range', () => {
    const moving = edgesOf(100, 233, 100, 44);
    const near = edgesOf(104, 600, 300, 10);
    const outOfRange = edgesOf(93, 600, 300, 10);
    const { dx } = computeSnap(moving, [near, outOfRange], artboard, 6);
    expect(dx).toBe(4);
  });

  it('snaps both axes independently', () => {
    const moving = edgesOf(98, 199, 100, 50);
    const other = edgesOf(100, 200, 100, 50);
    const { dx, dy, guides } = computeSnap(moving, [other], artboard, 6);
    expect(dx).toBe(2);
    expect(dy).toBe(1);
    expect(guides).toHaveLength(2);
  });

  it('matches a right edge against a left edge, so objects sit flush', () => {
    const moving = edgesOf(297, 300, 100, 50); // right edge at 397
    const other = edgesOf(400, 0, 50, 50);
    const { dx } = computeSnap(moving, [other], artboard, 6);
    expect(dx).toBe(3);
  });
});
