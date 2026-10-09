import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// A channel's posting time. With `tz`: minutes after local midnight in that
// IANA zone, so 09:00 stays 09:00 when the clocks change (E2E-05-85).
// Without: minutes after UTC midnight, as every slot was stored before.
export type PostingTime = { time: number; tz?: string };

const DAY = 24 * 60;

export const minutesOfDay = (minutes: number) =>
  ((Math.round(minutes) % DAY) + DAY) % DAY;

export const isTimeZone = (tz?: unknown): boolean => {
  if (typeof tz !== 'string' || !tz) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// The moment (UTC) of a posting time on a calendar day (YYYY-MM-DD), built
// from the wall-clock time in its zone.
export const postingTimeOn = (slot: PostingTime, day: string) => {
  if (!slot.tz) {
    return dayjs.utc(day).startOf('day').add(slot.time, 'minute');
  }
  const hh = String(Math.floor(slot.time / 60)).padStart(2, '0');
  const mm = String(slot.time % 60).padStart(2, '0');
  return dayjs.tz(`${day} ${hh}:${mm}`, slot.tz).utc();
};

// Where a posting time sits on `day` for someone in `tz`: minutes after their
// local midnight.
export const postingMinutesIn = (
  slot: PostingTime,
  day: string,
  tz: string
) => {
  const local = postingTimeOn(slot, day).tz(tz);
  return local.hour() * 60 + local.minute();
};
