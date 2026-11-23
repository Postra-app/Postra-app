/**
 * The step a wait is at, from the seconds already spent in it. Steps are
 * spread evenly over `expectedSeconds`; the last one stays until the work ends.
 */
export const waitingStep = (
  elapsedSeconds: number,
  steps: number,
  expectedSeconds: number
) => {
  if (steps <= 1 || expectedSeconds <= 0) {
    return 0;
  }
  const index = Math.floor((elapsedSeconds / expectedSeconds) * steps);
  return Math.max(0, Math.min(steps - 1, index));
};

/**
 * How full the bar is, in percent. It is an estimate, not a measurement: it
 * moves fast at first, slows down, and never reaches 100 on its own, so a
 * slower run than expected still shows movement instead of a full bar.
 */
export const waitingPercent = (
  elapsedSeconds: number,
  expectedSeconds: number
) => {
  if (expectedSeconds <= 0 || elapsedSeconds <= 0) {
    return 0;
  }
  const percent = 95 * (1 - Math.exp((-2.5 * elapsedSeconds) / expectedSeconds));
  return Math.round(Math.min(95, percent));
};
