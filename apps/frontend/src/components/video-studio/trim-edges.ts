/** Where a trim edge lands when the keyboard moves it to `to`.
 *
 * The edges keep a tenth of a second between them, or half the clip when the
 * clip is shorter than two tenths, and never leave the clip:
 * 0 <= start < end <= duration. */
export function moveTrimEdge(
  side: 'start' | 'end',
  to: number,
  current: { start: number; end: number },
  duration: number
): { start: number; end: number } {
  const gap = Math.min(0.1, duration / 2);
  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(v, lo), hi);
  if (side === 'start') {
    return { start: clamp(to, 0, Math.max(0, current.end - gap)), end: current.end };
  }
  return {
    start: current.start,
    end: clamp(to, Math.min(duration, current.start + gap), duration),
  };
}
