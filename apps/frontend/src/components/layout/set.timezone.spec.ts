import {
  fromUtc,
  newDayjs,
  setUserTimezone,
  toPickerDate,
} from './set.timezone';
import { slotDate } from '../launches/day-view.slots';

// The calendar draws in the timezone of the account, whatever the machine's
// is. A post was missing from the day view when the two differed: the cell
// was built in one timezone and the post's time read in the other.
describe('dates in the timezone of the account', () => {
  afterEach(() => setUserTimezone(null));

  it('reads a UTC date from the API on the account clock', () => {
    setUserTimezone('Asia/Tokyo');
    expect(fromUtc('2026-11-04T15:30:00Z').format('YYYY-MM-DD HH:mm')).toBe(
      '2026-11-05 00:30'
    );
    // the API sends dates without the Z too
    expect(fromUtc('2026-11-04T15:30:00').format('YYYY-MM-DD HH:mm')).toBe(
      '2026-11-05 00:30'
    );
  });

  it('a day view row and the post at that time meet', () => {
    setUserTimezone('Asia/Tokyo');
    const post = fromUtc('2026-11-04T15:30:00Z');
    const row = slotDate('2026-11-05', 30, 'Asia/Tokyo');
    expect(post.format('YYYY-MM-DD HH:mm')).toBe(
      row.format('YYYY-MM-DD HH:mm')
    );
  });

  it('a week view hour holds the post by its instant', () => {
    setUserTimezone('Asia/Tokyo');
    const cell = newDayjs('2026-11-05').hour(0);
    const post = fromUtc('2026-11-04T15:30:00Z').valueOf();
    expect(post >= cell.startOf('hour').valueOf()).toBe(true);
    expect(post < cell.endOf('hour').valueOf()).toBe(true);
    expect(cell.startOf('hour').toISOString()).toBe('2026-11-04T15:00:00.000Z');
  });

  it('the range asked from the API is the day of the account', () => {
    setUserTimezone('Asia/Tokyo');
    expect(newDayjs('2026-11-05').startOf('day').utc().format()).toBe(
      '2026-11-04T15:00:00Z'
    );
  });

  it('days follow the clock change of the account timezone', () => {
    setUserTimezone('Europe/London');
    const before = newDayjs('2026-03-28 12:00');
    const after = before.add(1, 'day');
    expect(after.format('YYYY-MM-DD HH:mm')).toBe('2026-03-29 12:00');
    // 23 hours apart: the clocks went forward that night
    expect(after.diff(before, 'hour')).toBe(23);
    // 01:30 does not exist there that night, it moves forward
    expect(newDayjs('2026-03-29 01:30').format('HH:mm')).toBe('02:30');
  });

  it('pickers get the wall clock of the account', () => {
    setUserTimezone('Asia/Tokyo');
    const picked = toPickerDate(fromUtc('2026-11-04T15:30:00Z'));
    expect([picked.getDate(), picked.getHours(), picked.getMinutes()]).toEqual(
      [5, 0, 30]
    );
  });

  it('no account timezone = the browser one, as before', () => {
    setUserTimezone(null);
    const local = new Date('2026-11-04T15:30:00Z');
    expect(fromUtc('2026-11-04T15:30:00Z').hour()).toBe(local.getHours());
  });

  it('a name that is not a timezone is ignored', () => {
    setUserTimezone('Mars/Olympus_Mons');
    const local = new Date('2026-11-04T15:30:00Z');
    expect(fromUtc('2026-11-04T15:30:00Z').hour()).toBe(local.getHours());
  });
});
