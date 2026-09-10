import { describeAge } from './save-indicator';

const t = (_key: string, fallback: string) => fallback;

describe('describeAge', () => {
  it('says "just now" for the first minute', () => {
    expect(describeAge(0, t)).toBe('Saved just now');
    expect(describeAge(59_000, t)).toBe('Saved just now');
  });

  it('switches to minutes, singular first', () => {
    expect(describeAge(60_000, t)).toBe('Saved a minute ago');
    expect(describeAge(119_000, t)).toBe('Saved a minute ago');
    expect(describeAge(120_000, t)).toBe('Saved 2 minutes ago');
  });

  // Clock skew between the snapshot and the render must not produce
  // "Saved -1 minutes ago".
  it('treats a negative age as just now', () => {
    expect(describeAge(-5_000, t)).toBe('Saved just now');
  });
});
