import dayjs from 'dayjs';

// Pure pieces of the calendar's date arithmetic, so they can be tested
// without a browser (final app check section 7, 2026-10-23).

const nextFullHour = (now: dayjs.Dayjs) => now.add(1, 'hour').startOf('hour');

// Where a dragged post lands. A week or day cell is one hour; a month cell
// stands for the whole day, so the post keeps its own time of day there. A
// target already gone (the current hour's cell, today's earlier time) goes to
// the next full hour: a queued post put on a past time would be published at
// once by the scheduler, which no drag should do (E2E-05-99).
export const dropTarget = (
  cell: dayjs.Dayjs,
  ownPublishDate: string | Date | undefined,
  wholeDay: boolean,
  now: dayjs.Dayjs
) => {
  let target = cell;
  if (wholeDay && ownPublishDate) {
    const own = dayjs.utc(ownPublishDate).local();
    target = cell.startOf('day').hour(own.hour()).minute(own.minute()).second(0);
  }
  return target.isBefore(now) ? nextFullHour(now) : target;
};

// The date the composer opens with from a calendar cell. A month cell used
// to pick a random hour of the day (E2E-05-100); now it is the earliest
// posting time any channel has that day, or 09:00 without one. A cell in the
// current hour starts ten minutes from now, a past time goes to the next
// full hour.
export const cellPostDate = (
  cell: dayjs.Dayjs,
  wholeDay: boolean,
  slotMinutes: number[],
  now: dayjs.Dayjs
) => {
  if (wholeDay) {
    const minutes = slotMinutes.length ? Math.min(...slotMinutes) : 9 * 60;
    const target = cell
      .startOf('day')
      .hour(Math.floor(minutes / 60))
      .minute(minutes % 60)
      .second(0);
    return target.isBefore(now) ? nextFullHour(now) : target;
  }
  // A day view slot has minutes (10:45); a future one is kept as it is
  // (Codex). The current hour's cell, or a slot of this hour already gone,
  // starts ten minutes from now; an earlier time goes to the next full hour.
  if (cell.isAfter(now)) {
    return cell;
  }
  if (cell.isSame(now, 'hour')) {
    return now.add(10, 'minute');
  }
  return nextFullHour(now);
};

// How often the calendar asks the server again. A queued post whose time has
// come (or comes within two minutes) is being published right now: poll
// every 15 s until it shows as PUBLISHED or ERROR, so the tile changes
// without a reload (E2E-05-102). Otherwise once an hour, as before.
export const PENDING_REFRESH_MS = 15_000;
export const IDLE_REFRESH_MS = 3_600_000;
// SWR reads this once per fetch, so a post due in three minutes must not get
// an hour's timer: the interval is at most the time until the nearest queued
// post enters the two-minute window (Codex).
export const PENDING_WINDOW_MS = 2 * 60_000;
export const calendarRefreshInterval = (
  posts: { state?: string; publishDate?: string | Date }[] | undefined,
  nowMs: number
) => {
  let next = IDLE_REFRESH_MS;
  for (const p of posts || []) {
    if (p.state !== 'QUEUE' || !p.publishDate) continue;
    const untilWindow = dayjs.utc(p.publishDate).valueOf() - PENDING_WINDOW_MS - nowMs;
    if (untilWindow <= 0) return PENDING_REFRESH_MS;
    next = Math.min(next, Math.max(PENDING_REFRESH_MS, untilWindow));
  }
  return next;
};
