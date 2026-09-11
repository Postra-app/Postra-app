import {
  LAST_ONLINE_THROTTLE_SECONDS,
  claimLastOnlineWrite,
} from '@gitroom/nestjs-libraries/redis/auth-context.cache';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

// E2E-09-03: DAU/WAU/MAU counted users whose lastOnline fell in a window, and
// nothing in the repo — or in upstream — ever wrote that column. It defaults to
// now() at sign-up, so the three cards were counting registrations. Measured on
// production: an evening of clicking as a signed-in admin left DAU at 0.
//
// The write has to be throttled, or it lands on every authenticated request.

describe('claiming a lastOnline write', () => {
  it('is granted once and then refused inside the window', async () => {
    const user = `user-${Math.random()}`;

    expect(await claimLastOnlineWrite(user)).toBe(true);
    expect(await claimLastOnlineWrite(user)).toBe(false);
    expect(await claimLastOnlineWrite(user)).toBe(false);
  });

  it('is tracked per user', async () => {
    const a = `user-a-${Math.random()}`;
    const b = `user-b-${Math.random()}`;

    expect(await claimLastOnlineWrite(a)).toBe(true);
    expect(await claimLastOnlineWrite(b)).toBe(true);
  });

  it('comes back once the window has passed', async () => {
    const user = `user-${Math.random()}`;
    expect(await claimLastOnlineWrite(user)).toBe(true);

    jest
      .spyOn(Date, 'now')
      .mockReturnValue(Date.now() + (LAST_ONLINE_THROTTLE_SECONDS + 1) * 1000);

    expect(await claimLastOnlineWrite(user)).toBe(true);
    jest.restoreAllMocks();
  });

  it('refuses rather than throwing when Redis is unavailable', async () => {
    jest.spyOn(ioRedis, 'set').mockRejectedValueOnce(new Error('no redis'));
    expect(await claimLastOnlineWrite('user-x')).toBe(false);
  });

  it('keeps the window short enough to be useful and long enough to be cheap', () => {
    expect(LAST_ONLINE_THROTTLE_SECONDS).toBeGreaterThanOrEqual(60);
    expect(LAST_ONLINE_THROTTLE_SECONDS).toBeLessThanOrEqual(60 * 60);
  });
});
