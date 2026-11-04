import {
  fromUtc,
  newDayjs,
  setUserTimezone,
  toPickerDay,
  toPickerTime,
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
    const post = fromUtc('2026-11-04T15:30:00Z');
    const day = toPickerDay(post);
    const time = toPickerTime(post);
    expect([day.getMonth(), day.getDate()]).toEqual([10, 5]);
    expect([time.getHours(), time.getMinutes()]).toEqual([0, 30]);
  });

  // An account on UTC, a machine in London: 01:30 on 29 March exists for the
  // account, but the machine skips that hour, and a native date built from
  // it read 02:30, which the time input then saved back.
  it("the time picker keeps an hour the machine's clock change skips", () => {
    const machine = process.env.TZ;
    process.env.TZ = 'Europe/London';
    try {
      setUserTimezone('UTC');
      const post = fromUtc('2026-03-29T01:30:00Z');
      expect(post.format('YYYY-MM-DD HH:mm')).toBe('2026-03-29 01:30');
      const time = toPickerTime(post);
      expect([time.getHours(), time.getMinutes()]).toEqual([1, 30]);
      expect(toPickerDay(post).getDate()).toBe(29);
    } finally {
      process.env.TZ = machine;
    }
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

// A timezone changed in another tab or on another device reaches an open page
// when it asks for the user again; what is on screen was drawn on the old
// clock, so the page has to be reloaded. The first answer is not a change.
describe('the account timezone changing while a page is open', () => {
  // a page that has just loaded: the module with no account timezone seen yet
  const fresh = async () => {
    jest.resetModules();
    return import('./set.timezone');
  };

  it('the first answer only sets the clock', async () => {
    const { accountTimezoneLoaded, getTimezone } = await fresh();
    expect(accountTimezoneLoaded('Asia/Tokyo')).toBe(false);
    expect(getTimezone()).toBe('Asia/Tokyo');
  });

  it('the same timezone again is no change', async () => {
    const { accountTimezoneLoaded } = await fresh();
    accountTimezoneLoaded('Asia/Tokyo');
    expect(accountTimezoneLoaded('Asia/Tokyo')).toBe(false);
    accountTimezoneLoaded(null);
    expect(accountTimezoneLoaded(undefined)).toBe(false);
  });

  it('another timezone, or back to automatic, asks for a reload', async () => {
    const { accountTimezoneLoaded, getTimezone } = await fresh();
    accountTimezoneLoaded('Asia/Tokyo');
    expect(accountTimezoneLoaded('America/New_York')).toBe(true);
    expect(getTimezone()).toBe('America/New_York');
    expect(accountTimezoneLoaded(null)).toBe(true);
  });
});
