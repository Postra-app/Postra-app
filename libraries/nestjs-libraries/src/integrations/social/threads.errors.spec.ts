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
