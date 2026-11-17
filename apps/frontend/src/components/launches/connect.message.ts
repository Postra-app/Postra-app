// /launches?msg=… showed whatever the address said as a Postra toast, so a
// link could make Postra "say" anything ("Your card was declined, call …").
// A message is shown only when this tab wrote it a moment ago, on its way
// back from connecting a channel; a successful connection has its own fixed
// text, whatever the address says.
const KEY = 'postra-connect-message';

export const rememberConnectMessage = (message: string) => {
  try {
    window.sessionStorage.setItem(KEY, message);
  } catch {
    // Storage blocked: the failure still shows on the connect page itself.
  }
};

export type ConnectToast = { text: string; kind: 'success' | 'warning' } | null;

export const connectMessageFromUrl = (
  search: { get: (name: string) => string | null },
  connectedText: string
): ConnectToast => {
  const fromUrl = search.get('msg');
  let remembered: string | null = null;
  try {
    remembered = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
  } catch {
    remembered = null;
  }
  if (search.get('added')) {
    return { text: connectedText, kind: 'success' };
  }
  if (fromUrl && remembered && remembered === fromUrl) {
    return { text: remembered, kind: 'warning' };
  }
  return null;
};
