jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { ThreadsProvider } from './threads.provider';

// Threads answers 4279009 when the container it just created is not
// findable yet; a retry a few seconds later publishes (upstream 5536d8a7).
describe('Threads errors', () => {
  const provider = new ThreadsProvider();

  it('"media container not found yet" (4279009) is retried, not a failed post', () => {
    const body = JSON.stringify({ error: { message: 'Media Not Found', code: 24, error_subcode: 4279009 } });
    expect(provider.handleErrors(body)?.type).toBe('retry');
  });

  it('an expired token still asks for a reconnect', () => {
    expect(provider.handleErrors('Error validating access token: Session has expired')?.type).toBe('refresh-token');
  });
});

// Upstream fb6f29c9b: a link Threads cannot attach (4279047) reached the
// customer as Meta's generic error.
it('says Threads refused the link attachment (4279047)', () => {
  const res = new ThreadsProvider().handleErrors(
    JSON.stringify({ error: { code: 100, error_subcode: 4279047, message: 'Invalid parameter' } })
  );
  expect(res).toEqual({
    type: 'bad-body',
    value: expect.stringMatching(/invalid link attachment/),
  });
});
