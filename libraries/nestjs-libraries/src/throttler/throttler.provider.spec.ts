import { clientIpFromForwardedFor, isCopilotMetadataQuery } from './throttler.provider';

// X-Forwarded-For is append-only: each hop adds what it saw. Behind exactly one
// trusted proxy the tail is the proxy's own observation and everything before it
// is attacker-controlled. Reading the head let a caller spoof a fresh throttle
// bucket per request.
describe('clientIpFromForwardedFor', () => {
  it('takes the proxy observation, not the value the client supplied', () => {
    expect(clientIpFromForwardedFor('10.9.9.1, 203.0.113.77')).toBe('203.0.113.77');
    expect(clientIpFromForwardedFor('evil, 1.1.1.1, 203.0.113.77')).toBe('203.0.113.77');
  });

  it('handles a single hop and stray whitespace', () => {
    expect(clientIpFromForwardedFor('203.0.113.77')).toBe('203.0.113.77');
    expect(clientIpFromForwardedFor('  203.0.113.77  ')).toBe('203.0.113.77');
  });

  it('returns empty so the caller can fall back to the socket address', () => {
    expect(clientIpFromForwardedFor(undefined)).toBe('');
    expect(clientIpFromForwardedFor('')).toBe('');
    expect(clientIpFromForwardedFor(' , , ')).toBe('');
  });
});

// The page-load metadata query skips the AI limit; nothing that can reach a
// model may pass for it.
describe('isCopilotMetadataQuery', () => {
  it('is the info request CopilotKit sends on page load', () => {
    expect(isCopilotMetadataQuery({ method: 'info' })).toBe(true);
  });

  it('is not a run, a suggestion or a connect, whatever else the body says', () => {
    expect(isCopilotMetadataQuery({ method: 'agent/run', params: { agentId: 'default' } })).toBe(false);
    expect(isCopilotMetadataQuery({ method: 'agent/suggest', operationName: 'availableAgents' })).toBe(false);
    expect(isCopilotMetadataQuery({ method: 'agent/connect' })).toBe(false);
  });

  it('is not the GraphQL body of CopilotKit 1.10, nor an empty body', () => {
    expect(
      isCopilotMetadataQuery({ operationName: 'availableAgents', query: 'query availableAgents { availableAgents { agents { name } } }' })
    ).toBe(false);
    expect(isCopilotMetadataQuery(undefined)).toBe(false);
    expect(isCopilotMetadataQuery(null)).toBe(false);
  });
});
