// customFetch hands 4xx answers back instead of throwing, so a caller that
// does not look at the status shows its success message over a refused write
// (E2E-08-36). The server's own message when it gave one, else the fallback.
export const refusalMessage = async (res: Response, fallback: string) => {
  try {
    const body = await res.clone().json();
    const message = Array.isArray(body?.message) ? body.message[0] : body?.message ?? body?.msg;
    return typeof message === 'string' && message ? message : fallback;
  } catch {
    return fallback;
  }
};
