const captureException = jest.fn();
const flush = jest.fn().mockResolvedValue(true);
jest.mock('@sentry/nestjs', () => ({ captureException, flush }));

import { failBoot } from './boot.failed';

describe('failBoot', () => {
  // A start that failed (the port taken by a leftover process, say) used to
  // be logged and left running: pm2 showed it online with nothing listening,
  // the silent state of B0, until a watchdog replaced the container minutes
  // later. Exiting lets pm2 start it again at once.
  it('reports the error and exits with 1', async () => {
    const exit = jest.fn() as unknown as (code: number) => never;
    const error = new Error('listen EADDRINUSE: address already in use :::3000');

    await failBoot(error, exit);

    expect(captureException).toHaveBeenCalledWith(error);
    expect(flush).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits even when Sentry cannot flush', async () => {
    flush.mockRejectedValueOnce(new Error('offline'));
    const exit = jest.fn() as unknown as (code: number) => never;

    await failBoot('boom', exit);

    expect(exit).toHaveBeenCalledWith(1);
  });
});
