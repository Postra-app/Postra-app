import { fetch as undiciFetch } from 'undici';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';

// For a server the customer named (their Bluesky PDS, their WordPress site).
// The address is checked once when they type it, but the requests that
// followed used the plain fetch: a redirect, or the address a PDS gives for
// itself after login, led wherever that server said, hosts inside our
// network included. This fetch checks the address of every connection it
// opens, on every hop.
//
// Clients such as the Bluesky one build a Request and pass it in. That
// Request belongs to the runtime's own fetch, and the undici package does not
// recognise it: it read it as the string "[object Request]" and every call
// failed with an invalid URL. Its parts are passed instead.
export const instanceFetch = (async (input: any, init?: any) => {
  if (
    input &&
    typeof input === 'object' &&
    !(input instanceof URL) &&
    typeof input.url === 'string' &&
    typeof input.method === 'string'
  ) {
    const method = input.method.toUpperCase();
    const body =
      method === 'GET' || method === 'HEAD' || input.body === null
        ? undefined
        : Buffer.from(await input.arrayBuffer());
    return undiciFetch(input.url, {
      method,
      headers: [...input.headers],
      body,
      redirect: input.redirect,
      signal: input.signal,
      ...init,
      dispatcher: ssrfSafeDispatcher,
    });
  }
  return undiciFetch(input, {
    ...init,
    dispatcher: ssrfSafeDispatcher,
  });
}) as unknown as typeof globalThis.fetch;

const BLUESKY_OWN = /(^|\.)(bsky\.social|bsky\.network)$/i;

const pdsOf = (doc: any): string | null => {
  const entry = (Array.isArray(doc?.service) ? doc.service : []).find(
    (s: any) => typeof s?.id === 'string' && s.id.endsWith('#atproto_pds')
  );
  try {
    return entry ? new URL(String(entry.serviceEndpoint)).origin : null;
  } catch {
    return null;
  }
};

// Whether the account really lives on the server that vouched for it. A
// server of one's own can answer a login with anyone's DID; the channel was
// then saved under that DID and its real owner was told it is "already
// connected to another Postra account". The DID's own public document says
// where the account is hosted. Bluesky's servers are taken at their word.
export async function blueskyDidIsHostedAt(
  did: string,
  service: string,
  fetchImpl: typeof globalThis.fetch = instanceFetch
): Promise<boolean> {
  let host: URL;
  try {
    host = new URL(service);
  } catch {
    return false;
  }
  if (BLUESKY_OWN.test(host.hostname)) {
    return true;
  }
  let documentUrl: string;
  if (/^did:plc:[a-z2-7]{24}$/.test(did)) {
    documentUrl = `https://plc.directory/${did}`;
  } else if (/^did:web:[A-Za-z0-9.-]+$/.test(did)) {
    documentUrl = `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
  } else {
    return false;
  }
  try {
    const res = await fetchImpl(documentUrl, {
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (!res.ok) {
      return false;
    }
    return pdsOf(await res.json()) === host.origin;
  } catch {
    return false;
  }
}
