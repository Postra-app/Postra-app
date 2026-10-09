jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));
jest.mock('@gitroom/nestjs-libraries/database/prisma/integrations/integration.service', () => ({
  IntegrationService: class {},
}));

import { LinkedinProvider } from './linkedin.provider';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { isTransientRefreshError } from '../refresh.integration.service';

// E2E-04-26 (rest): LinkedIn answers an outage with an HTML page. The token
// refresh parsed it as JSON, the SyntaxError counted as a refused grant, and
// the channel was marked "reconnect needed" for a provider hiccup.
describe('LinkedIn token refresh during an outage', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  const answer = (status: number, body: string, type: string) => {
    global.fetch = jest.fn(
      async () => new Response(body, { status, headers: { 'Content-Type': type } })
    ) as any;
  };

  it.each([
    ['personal', () => new LinkedinProvider()],
    ['page', () => new LinkedinPageProvider()],
  ])('a 503 page is a passing outage (%s)', async (_, provider) => {
    answer(503, '<html><body><h1>Service Unavailable</h1></body></html>', 'text/html');
    const err = await provider().refreshToken('r').catch((e) => e);
    expect(isTransientRefreshError(err)).toBe(true);
  });

  it('a refused grant is not', async () => {
    // LinkedIn's answer to an expired refresh token.
    answer(
      400,
      '{"error":"invalid_grant","error_description":"The provided authorization grant or refresh token is invalid, expired or revoked"}',
      'application/json'
    );
    const err = await new LinkedinProvider().refreshToken('r').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isTransientRefreshError(err)).toBe(false);
  });
});
