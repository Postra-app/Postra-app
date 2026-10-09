import {
  FetchHandledError,
  FetchTimeoutError,
  NETWORK_FAILURE_PATTERNS,
  isFetchHandledError,
  isNetworkError,
} from './fetch.errors';

describe('FetchHandledError', () => {
  it('is an Error that carries the status and a handled marker', () => {
    const e = new FetchHandledError(406);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('FetchHandledError');
    expect(e.status).toBe(406);
    // GlobalErrorLogger / SwrProvider swallow it by checking this name/flag.
    expect(e.handled).toBe(true);
    expect(e.message).toContain('406');
  });
});

describe('isFetchHandledError', () => {
  it('recognises the marker so a catch can skip its own message', () => {
    expect(isFetchHandledError(new FetchHandledError(502))).toBe(true);
  });

  // The name check (not instanceof) is what makes this hold across separately
  // bundled client chunks — a structurally identical object must pass too.
  it('recognises a structurally identical error from another bundle', () => {
    expect(isFetchHandledError({ name: 'FetchHandledError', status: 502 })).toBe(
      true
    );
  });

  it('rejects unrelated failures, so real crashes still surface', () => {
    expect(isFetchHandledError(new FetchTimeoutError('/posts'))).toBe(false);
    expect(isFetchHandledError(new TypeError('Load failed'))).toBe(false);
    // the Safari DOMException this whole change exists to stop reporting
    expect(
      isFetchHandledError(
        Object.assign(
          new Error('The string did not match the expected pattern.'),
          { name: 'SyntaxError' }
        )
      )
    ).toBe(false);
    expect(isFetchHandledError(undefined)).toBe(false);
    expect(isFetchHandledError(null)).toBe(false);
  });
});

describe('FetchTimeoutError', () => {
  it('is an Error that names itself and keeps the url', () => {
    const e = new FetchTimeoutError('/posts');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('FetchTimeoutError');
    expect(e.url).toBe('/posts');
    expect(e.message).toContain('/posts');
  });
});

// The whole point of isNetworkError is telling "your wifi died" apart from
// "the app broke". Wrong in one direction and a user with no signal is told to
// refresh the page; wrong in the other and a real crash is blamed on the
// connection and dropped from Sentry.
describe('isNetworkError', () => {
  it.each([
    ['Chrome / Edge', 'Failed to fetch'],
    ['Chrome, with the url appended', 'Failed to fetch https://api/foo'],
    ['Safari', 'Load failed'],
    ['Firefox', 'NetworkError when attempting to fetch resource.'],
    ['WebKit / iOS', 'The Internet connection appears to be offline.'],
    ['WebKit / iOS, mid-request', 'The network connection was lost.'],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isNetworkError(new TypeError(message))).toBe(true);
  });

  it('counts our own abort - customFetch only fires it after 120s', () => {
    expect(isNetworkError(new FetchTimeoutError('/posts'))).toBe(true);
  });

  it('matches by name, so it holds across separately bundled chunks', () => {
    expect(isNetworkError({ name: 'FetchTimeoutError' })).toBe(true);
  });

  it.each([
    ['a globally handled response', new FetchHandledError(402)],
    ['a real render crash', new TypeError('x.map is not a function')],
    ['a parse failure', new SyntaxError('Unexpected token < in JSON')],
    ['a plain error', new Error('boom')],
    ['a message that merely mentions fetching', new Error('Refetch failed')],
  ])('does not claim %s is a network failure', (_case, error) => {
    expect(isNetworkError(error)).toBe(false);
  });

  it.each([[undefined], [null], [''], [0], [{}]])('is safe on %p', (value) => {
    expect(isNetworkError(value)).toBe(false);
  });
});

describe('NETWORK_FAILURE_PATTERNS', () => {
  // Sentry's beforeSend drops every event matching this list. If a pattern
  // lost its anchor it would silently swallow unrelated crashes that happen to
  // quote the wording.
  it('only matches from the start of the message', () => {
    expect(
      NETWORK_FAILURE_PATTERNS.some((pattern) =>
        pattern.test('Cannot read properties of undefined (Load failed)')
      )
    ).toBe(false);
  });
});
