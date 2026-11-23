import {
  waitingPercent,
  waitingStep,
} from '@gitroom/frontend/components/ui/waiting-status.helpers';

describe('waitingStep', () => {
  it('starts at the first message and ends on the last one', () => {
    expect(waitingStep(0, 4, 30)).toBe(0);
    expect(waitingStep(8, 4, 30)).toBe(1);
    expect(waitingStep(29, 4, 30)).toBe(3);
  });

  it('stays on the last message when the work runs over', () => {
    expect(waitingStep(300, 4, 30)).toBe(3);
  });

  it('copes with a single message and a zero estimate', () => {
    expect(waitingStep(10, 1, 30)).toBe(0);
    expect(waitingStep(10, 4, 0)).toBe(0);
  });
});

describe('waitingPercent', () => {
  it('grows with time and never shows a full bar on its own', () => {
    const early = waitingPercent(5, 30);
    const late = waitingPercent(30, 30);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
    expect(waitingPercent(3000, 30)).toBeLessThanOrEqual(95);
  });

  it('is empty before the work starts', () => {
    expect(waitingPercent(0, 30)).toBe(0);
  });
});
