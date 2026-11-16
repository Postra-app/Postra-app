import { AtpAgent } from '@atproto/api';

// The Bluesky client builds a Request and hands it to the fetch it was given.
// The Request comes from the runtime's fetch, the fetch here from the undici
// package: undici does not recognise the other's Request, read it as a
// string ("[object Request]") and failed every call with an invalid URL.
const calls: { input: unknown; init: any }[] = [];
jest.mock('undici', () => {
  const actual = jest.requireActual('undici');
  return {
    ...actual,
    fetch: jest.fn(async (input: unknown, init: any) => {
      calls.push({ input, init });
      if (typeof input !== 'string' && !(input instanceof URL)) {
        throw new TypeError('Failed to parse URL from [object Request]');
      }
      return new Response(
        JSON.stringify({ did: 'did:web:bsky.social', availableUserDomains: ['.bsky.social'] }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }),
  };
});

import { instanceFetch } from './instance.fetch';

describe('a Request from the runtime goes through the checked fetch', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('keeps the address, method, headers and body', async () => {
    const res = await instanceFetch(
      new Request('https://pds.example.com/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'hello' }),
      })
    );
    expect(res.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const { input, init } = calls[0];
    expect(String(input)).toBe('https://pds.example.com/xrpc/com.atproto.repo.createRecord');
    expect(typeof input === 'string' || input instanceof URL).toBe(true);
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer token');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(Buffer.from(init.body).toString()).toBe('{"text":"hello"}');
    expect(init.dispatcher).toBeDefined();
  });

  it('options passed next to the Request win', async () => {
    await instanceFetch(new Request('https://pds.example.com/x', { method: 'GET' }), {
      redirect: 'manual',
    } as any);
    expect(calls[0].init.redirect).toBe('manual');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
  });

  it('the Bluesky client works through it', async () => {
    const agent = new AtpAgent({ service: 'https://bsky.social', fetch: instanceFetch });
    const { data } = await agent.com.atproto.server.describeServer();
    expect(data.availableUserDomains).toEqual(['.bsky.social']);
    expect(String(calls[0].input)).toBe('https://bsky.social/xrpc/com.atproto.server.describeServer');
  });
});
