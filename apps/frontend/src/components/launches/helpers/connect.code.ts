/**
 * Credentials typed for a channel (a Bluesky app password, a WordPress
 * password) go from the Add Channel form to the connect page in this tab's
 * session storage, not in the address: an address stays in the browser
 * history and in the request log of every server it passes. The address
 * carries `code=stored`, and the connect page reads the value once.
 */
export const CONNECT_CODE_STORED = 'stored';

const key = (state: string) => `postra-connect-code:${state}`;

/** The value for `code=` in the connect address. */
export const stashConnectCode = (state: string, code: string): string => {
  try {
    window.sessionStorage.setItem(key(state), code);
    return CONNECT_CODE_STORED;
  } catch {
    // Storage blocked: fall back to the address, as before.
    return code;
  }
};

export const readConnectCode = (state: string): string | undefined => {
  try {
    return window.sessionStorage.getItem(key(state)) ?? undefined;
  } catch {
    return undefined;
  }
};

export const dropConnectCode = (state: string) => {
  try {
    window.sessionStorage.removeItem(key(state));
  } catch {
    // Nothing stored.
  }
};
