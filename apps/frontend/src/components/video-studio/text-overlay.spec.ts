import { safeAreaMargin } from './text-overlay';

describe('safeAreaMargin', () => {
  it('keeps captions clear of the interface on a 9:16 clip', () => {
    // TikTok and Reels cover roughly the bottom 250-300 px at 1080x1920. The
    // old flat 4 % put the band at 77 px from the bottom, underneath them.
    const { bottom } = safeAreaMargin(1080, 1920);
    expect(bottom).toBeGreaterThanOrEqual(250);
  });

  it('does not waste the frame on square and landscape', () => {
    expect(safeAreaMargin(1080, 1080).bottom).toBe(43);
    expect(safeAreaMargin(1920, 1080).bottom).toBe(43);
  });

  it('treats 4:5 as not vertical enough to need the deep margin', () => {
    expect(safeAreaMargin(1080, 1350).bottom).toBe(54);
  });

  it('scales with the frame rather than assuming 1080 wide', () => {
    expect(safeAreaMargin(540, 960).bottom).toBe(125);
  });
});
