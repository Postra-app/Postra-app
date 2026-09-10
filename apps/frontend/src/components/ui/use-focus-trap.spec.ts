import { nextFocusIndex, FOCUSABLE_SELECTOR } from './use-focus-trap';

describe('nextFocusIndex', () => {
  it('moves forward and wraps at the end', () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it('moves backward and wraps at the start', () => {
    expect(nextFocusIndex(2, 3, true)).toBe(1);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
  });

  // Focus starting outside the dialog (the overlay itself, say) has to land
  // somewhere sensible rather than nowhere.
  it('enters at an end when nothing inside is focused', () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it('answers -1 for a dialog with nothing focusable', () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
  });
});

describe('FOCUSABLE_SELECTOR', () => {
  it('skips disabled controls and tabindex -1', () => {
    expect(FOCUSABLE_SELECTOR).toContain('button:not([disabled])');
    expect(FOCUSABLE_SELECTOR).toContain('[tabindex]:not([tabindex="-1"])');
  });
});
