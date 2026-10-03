import { describeError } from './temporal.heartbeat';

describe('describeError', () => {
  it('keeps the reason undici hides in cause', () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
    const err = new TypeError('fetch failed', { cause: socket });
    expect(describeError(err)).toBe('fetch failed (UND_ERR_SOCKET: other side closed)');
  });

  it('follows a longer chain and stops at four links', () => {
    let e: Error = new Error('root');
    for (const m of ['three', 'two', 'one', 'top']) e = new Error(m, { cause: e });
    expect(describeError(e)).toBe('top (one ← two ← three)');
  });

  it('is the plain message when there is no cause', () => {
    expect(describeError(new Error('bad request'))).toBe('bad request');
    expect(describeError('text')).toBe('text');
  });
});
