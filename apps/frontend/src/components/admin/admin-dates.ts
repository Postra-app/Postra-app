/**
 * Day handling for the admin panel.
 *
 * Two things went wrong here and both came from treating a date as a string.
 *
 * Stats built its range with `toISOString().slice(0, 10)`, which reads the
 * clock in UTC. Under BST that made "today" yesterday for the first hour after
 * midnight, and the header — rendering the server's inclusive 23:59:59 UTC end
 * back through toLocaleDateString — showed tomorrow, on every preset, all
 * summer (E2E-09-24).
 *
 * Growth sliced the ISO day apart to label its axis, so a twelve-month chart
 * read "22 23 24 25 26 27 28 14 15 26 28 9" — day numbers with no month and no
 * year — and the tooltip never carried a year either (E2E-09-04).
 */

/** An ISO day built from the local calendar, not from UTC. */
export const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export const today = () => isoLocal(new Date());

export const isoDaysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoLocal(d);
};

export const startOfWeek = () => {
  const d = new Date();
  // ISO week: Monday = 0
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoLocal(d);
};

export const startOfMonth = () => {
  const d = new Date();
  d.setDate(1);
  return isoLocal(d);
};

/** Parsed at local midnight; `new Date('2026-09-11')` would be UTC midnight. */
const asDate = (day: string) => new Date(`${day}T00:00:00`);

const isValid = (d: Date) => !Number.isNaN(d.getTime());

/** A day for the range header, in the viewer's own format. */
export const formatDay = (day: string) => {
  const date = asDate(day);
  return isValid(date) ? date.toLocaleDateString() : day;
};

/**
 * A chart axis tick. Long ranges collapse to month and year, because a
 * year of day numbers says nothing.
 */
export const axisLabel = (day: string, points: number) => {
  const date = asDate(day);
  if (!isValid(date)) {
    return day;
  }
  return points > 40
    ? date.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' })
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/** The tooltip over a bar — always a whole date. */
export const fullLabel = (day: string) => {
  const date = asDate(day);
  return isValid(date)
    ? date.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : day;
};
