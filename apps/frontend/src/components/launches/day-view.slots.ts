import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// The day view lays out one row per minute of the day, in the user's time
// zone. Rows used to be minutes after UTC midnight laid on the selected day
// as UTC, so away from UTC a post at 00:30 landed in a row of the next day
// and was not shown (E2E-05-61).

export const minutesInZone = (utcDate: string | Date, tz: string) => {
  const local = dayjs.utc(utcDate).tz(tz);
  return local.hour() * 60 + local.minute();
};

// A channel's posting times are stored as minutes after UTC midnight.
export const postingMinutesInZone = (
  utcMinutes: number,
  day: string,
  tz: string
) =>
  minutesInZone(
    dayjs.utc(day).startOf('day').add(utcMinutes, 'minute').toDate(),
    tz
  );

// The row's moment on `day` (YYYY-MM-DD) in `tz`, built from the wall-clock
// time so a daylight-saving change that day does not shift later rows.
export const slotDate = (day: string, minutes: number, tz: string) => {
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return dayjs.tz(`${day} ${hh}:${mm}`, tz);
};
