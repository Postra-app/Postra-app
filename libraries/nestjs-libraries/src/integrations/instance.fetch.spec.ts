import http from 'node:http';
import { AddressInfo } from 'node:net';
import { blueskyDidIsHostedAt, instanceFetch } from './instance.fetch';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';

describe("a server the customer named", () => {
  let internal: http.Server;
  let port: number;
  let hits = 0;
  beforeAll(async () => {
    internal = http.createServer((_req, res) => {
      hits += 1;
      res.end('{"id":"internal-secret"}');
    });
    await new Promise<void>((r) => internal.listen(0, '127.0.0.1', r));
    port = (internal.address() as AddressInfo).port;
  });
  afterAll(() => new Promise((r) => internal.close(r)));

  it('the plain fetch reaches a service inside the network', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(await res.text()).toContain('internal-secret');
  });

  it('this one refuses the connection, whatever led there', async () => {
    const before = hits;
    await expect(instanceFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
    await expect(instanceFetch(`http://localhost:${port}/xrpc/com.atproto.repo.createRecord`, { method: 'POST', body: '{}' })).rejects.toThrow();
    expect(hits).toBe(before);
  });
});

describe('whose Bluesky account a server may vouch for', () => {
  const doc = (endpoint: string) =>
    (async () => ({
      ok: true,
      json: async () => ({ service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint }] }),
    })) as any;

  it("Bluesky's own servers are taken at their word", async () => {
    const never = jest.fn();
    expect(await blueskyDidIsHostedAt(DID, 'https://bsky.social', never as any)).toBe(true);
    expect(await blueskyDidIsHostedAt(DID, 'https://morel.us-east.host.bsky.network', never as any)).toBe(true);
    expect(never).not.toHaveBeenCalled();
  });

  it('a server of one\'s own vouches only for accounts hosted there', async () => {
    expect(await blueskyDidIsHostedAt(DID, 'https://pds.example.com', doc('https://pds.example.com'))).toBe(true);
    // The DID of someone on Bluesky, returned by another server's login.
    expect(await blueskyDidIsHostedAt(DID, 'https://evil.example', doc('https://morel.us-east.host.bsky.network'))).toBe(false);
  });

  it('a look-alike of Bluesky is not Bluesky', async () => {
    expect(await blueskyDidIsHostedAt(DID, 'https://bsky.social.evil.example', doc('https://x.example'))).toBe(false);
    expect(await blueskyDidIsHostedAt(DID, 'https://notbsky.social', doc('https://x.example'))).toBe(false);
  });

  it('an unreadable or odd DID is refused', async () => {
    const down = (async () => ({ ok: false })) as any;
    expect(await blueskyDidIsHostedAt(DID, 'https://pds.example.com', down)).toBe(false);
    expect(await blueskyDidIsHostedAt('did:key:z6Mk', 'https://pds.example.com', doc('https://pds.example.com'))).toBe(false);
    expect(await blueskyDidIsHostedAt('did:web:10.0.0.1/x', 'https://pds.example.com', doc('https://pds.example.com'))).toBe(false);
  });
});
