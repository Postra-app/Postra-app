import { MIN_UPLOAD_MS, uploadDeadlineMs, uploadSignal } from './upload-deadline';

// A Studio clip upload stopped after 120 seconds, the limit every request
// gets: 150 MB at 5 Mb/s takes four minutes, so it failed every time.
describe('upload deadline', () => {
  it('gives a 150 MB clip time for a slow home connection', () => {
    const ms = uploadDeadlineMs(150 * 1024 * 1024);
    // At 5 Mb/s the upload takes about 252 s.
    expect(ms).toBeGreaterThan(252_000);
    expect(ms).toBeLessThan(60 * 60 * 1000);
  });

  it('never gives less than the usual two minutes', () => {
    expect(uploadDeadlineMs(10)).toBe(MIN_UPLOAD_MS);
  });

  it('aborts at the deadline and not before', () => {
    jest.useFakeTimers();
    try {
      const { signal, done } = uploadSignal(150 * 1024 * 1024);
      jest.advanceTimersByTime(130_000);
      expect(signal.aborted).toBe(false);
      jest.advanceTimersByTime(uploadDeadlineMs(150 * 1024 * 1024));
      expect(signal.aborted).toBe(true);
      done();
    } finally {
      jest.useRealTimers();
    }
  });
});
