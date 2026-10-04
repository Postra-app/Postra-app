import { clientIpFromForwardedFor, isCopilotMetadataQuery } from './throttler.provider';

// X-Forwarded-For is append-only: each hop adds what it saw. Behind exactly one
// trusted proxy the tail is the proxy's own observation and everything before it
// is attacker-controlled. Reading the head let a caller spoof a fresh throttle
// bucket per request — e2e/bugs.md E2E-02-01.
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
  const query = 'query availableAgents {\n  availableAgents { agents { name id } }\n}';

  it('is the availableAgents query CopilotKit sends on page load', () => {
    expect(isCopilotMetadataQuery({ operationName: 'availableAgents', query })).toBe(true);
  });

  it('is not a mutation, whatever its name', () => {
    expect(
      isCopilotMetadataQuery({
        operationName: 'availableAgents',
        query: 'mutation availableAgents { generateCopilotResponse(data: {}) { threadId } }',
      })
    ).toBe(false);
    expect(
      isCopilotMetadataQuery({
        operationName: 'availableAgents',
        query: `${query}\nmutation generateCopilotResponse { generateCopilotResponse(data: {}) { threadId } }`,
      })
    ).toBe(false);
  });

  it('is not any other operation, nor a body without a query', () => {
    expect(isCopilotMetadataQuery({ operationName: 'generateCopilotResponse', query })).toBe(false);
    expect(isCopilotMetadataQuery({ operationName: 'availableAgents' })).toBe(false);
    expect(isCopilotMetadataQuery(undefined)).toBe(false);
  });
});
