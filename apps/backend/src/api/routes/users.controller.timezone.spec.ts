import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));
jest.mock('nostr-tools', () => ({ getPublicKey: jest.fn(), Relay: class {}, finalizeEvent: jest.fn(), SimplePool: class {} }));
const bustAuthContextCache = jest.fn().mockResolvedValue(undefined);
jest.mock('@gitroom/backend/services/auth/auth.middleware', () => ({
  bustAuthContextCache: (...args: unknown[]) => bustAuthContextCache(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsersController } = require('./users.controller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TimezoneDto } = require('@gitroom/nestjs-libraries/dtos/users/timezone.dto');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { UsersRepository } = require('@gitroom/nestjs-libraries/database/prisma/users/users.repository');

// The timezone picked in Settings is stored on the user, so every device
// and every page shows the calendar on the same clock.
describe('timezone of the account', () => {
  const errors = async (body: object) =>
    (await validate(plainToInstance(TimezoneDto, body))).length;

  it.each([{ timezoneName: 'Asia/Tokyo' }, { timezoneName: 'Europe/London' }, { timezoneName: null }, {}])(
    'accepts %p',
    async (body) => {
      expect(await errors(body)).toBe(0);
    }
  );

  it.each([{ timezoneName: 'Mars/Olympus_Mons' }, { timezoneName: '' }, { timezoneName: 42 }, { timezoneName: '<script>' }])(
    'refuses %p',
    async (body) => {
      expect(await errors(body)).toBeGreaterThan(0);
    }
  );

  it('stores the name, and nothing for the browser timezone', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'u1' });
    const repo = new UsersRepository({ model: { user: { update } } }, {});
    await repo.updateTimezone('u1', { timezoneName: 'Asia/Tokyo' });
    await repo.updateTimezone('u1', {});
    expect(update.mock.calls.map(([args]) => args)).toEqual([
      { where: { id: 'u1' }, data: { timezoneName: 'Asia/Tokyo' }, select: { id: true } },
      { where: { id: 'u1' }, data: { timezoneName: null }, select: { id: true } },
    ]);
  });

  it('drops the cached user, so the reloaded page gets the new timezone', async () => {
    bustAuthContextCache.mockClear();
    const updateTimezone = jest.fn().mockResolvedValue(undefined);
    const controller = Object.create(UsersController.prototype);
    Object.assign(controller, { _userService: { updateTimezone } });
    const res = await controller.updateTimezone({ id: 'u1' }, { timezoneName: 'Asia/Tokyo' });
    expect(updateTimezone).toHaveBeenCalledWith('u1', { timezoneName: 'Asia/Tokyo' });
    expect(bustAuthContextCache).toHaveBeenCalledWith('u1');
    expect(updateTimezone.mock.invocationCallOrder[0]).toBeLessThan(
      bustAuthContextCache.mock.invocationCallOrder[0]
    );
    expect(res).toEqual({ timezoneName: 'Asia/Tokyo' });
  });
});
