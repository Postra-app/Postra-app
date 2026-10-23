import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  calendarRefreshInterval,
  cellPostDate,
  dropTarget,
  IDLE_REFRESH_MS,
  PENDING_REFRESH_MS,
} from './calendar.helpers';

dayjs.extend(utc);

const now = dayjs('2026-10-23T10:33:00');

describe('dropTarget (E2E-05-99)', () => {
  it('a week cell in the future is the cell itself', () => {
    const cell = dayjs('2026-10-24T15:00:00');
    expect(dropTarget(cell, '2026-10-30T12:00:00Z', false, now).isSame(cell)).toBe(true);
  });

  it("the current hour's cell does not put the post in the past", () => {
    // the cell is 10:00, now is 10:33: the old code sent 10:00 and the
    // scheduler published the post at once
    const target = dropTarget(now.startOf('hour'), undefined, false, now);
    expect(target.isAfter(now)).toBe(true);
    expect(target.format('HH:mm')).toBe('11:00');
  });

  it('a month cell keeps the post’s own time of day', () => {
    const cell = dayjs('2026-10-28T23:59:59');
    const own = dayjs('2026-10-30T14:45:00').utc().toISOString();
    expect(dropTarget(cell, own, true, now).format('YYYY-MM-DD HH:mm')).toBe('2026-10-28 14:45');
  });

  it("today's month cell with the own time gone goes to the next full hour", () => {
    const cell = dayjs('2026-10-23T23:59:59');
    const own = dayjs('2026-10-30T08:00:00').utc().toISOString();
    expect(dropTarget(cell, own, true, now).format('YYYY-MM-DD HH:mm')).toBe('2026-10-23 11:00');
  });
});

describe('cellPostDate (E2E-05-100)', () => {
  it('a month cell opens at the earliest posting time of the channels', () => {
    const cell = dayjs('2026-10-28T23:59:59');
    expect(cellPostDate(cell, true, [11 * 60 + 40, 7 * 60 + 30], now).format('YYYY-MM-DD HH:mm')).toBe('2026-10-28 07:30');
  });

  it('a month cell without posting times opens at 09:00, never at a random hour', () => {
    const cell = dayjs('2026-10-28T23:59:59');
    for (let i = 0; i < 20; i++) {
      expect(cellPostDate(cell, true, [], now).format('HH:mm')).toBe('09:00');
    }
  });

  it("today's month cell with the slot already gone opens at the next full hour", () => {
    const cell = dayjs('2026-10-23T23:59:59');
    expect(cellPostDate(cell, true, [9 * 60], now).format('HH:mm')).toBe('11:00');
  });

  it('the current hour opens ten minutes from now, a future cell as it is', () => {
    expect(cellPostDate(now.startOf('hour'), false, [], now).format('HH:mm')).toBe('10:43');
    const cell = dayjs('2026-10-23T15:00:00');
    expect(cellPostDate(cell, false, [], now).isSame(cell)).toBe(true);
  });
});

describe('calendarRefreshInterval (E2E-05-102)', () => {
  const nowMs = now.valueOf();
  it('polls while a queued post is due', () => {
    const due = dayjs.utc(nowMs).subtract(30, 'second').toISOString();
    expect(calendarRefreshInterval([{ state: 'QUEUE', publishDate: due }], nowMs)).toBe(PENDING_REFRESH_MS);
    const soon = dayjs.utc(nowMs).add(90, 'second').toISOString();
    expect(calendarRefreshInterval([{ state: 'QUEUE', publishDate: soon }], nowMs)).toBe(PENDING_REFRESH_MS);
  });

  it('stays hourly for posts far ahead, published, failed or drafts', () => {
    const later = dayjs.utc(nowMs).add(1, 'hour').toISOString();
    const earlier = dayjs.utc(nowMs).subtract(1, 'hour').toISOString();
    expect(
      calendarRefreshInterval(
        [
          { state: 'QUEUE', publishDate: later },
          { state: 'PUBLISHED', publishDate: earlier },
          { state: 'ERROR', publishDate: earlier },
          { state: 'DRAFT', publishDate: earlier },
        ],
        nowMs
      )
    ).toBe(IDLE_REFRESH_MS);
    expect(calendarRefreshInterval(undefined, nowMs)).toBe(IDLE_REFRESH_MS);
  });
});
