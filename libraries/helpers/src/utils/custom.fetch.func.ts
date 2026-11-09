import { FetchHandledError, FetchTimeoutError } from './fetch.errors';

// Generous cap: well above any legitimate request (including AI generation and
// media saves) so it never aborts real work — it only unsticks a genuinely
// dead connection that would otherwise hang the spinner forever.
const DEFAULT_TIMEOUT_MS = 120000;

export interface Params {
  baseUrl: string;
  beforeRequest?: (url: string, options: RequestInit) => Promise<RequestInit>;
  afterRequest?: (
    url: string,
    options: RequestInit,
    response: Response
  ) => Promise<boolean>;
}
export const customFetch = (
  params: Params,
  auth?: string,
  showorg?: string,
  secured: boolean = true
) => {
  return async function newFetch(url: string, options: RequestInit = {}) {
    const newRequestObject = await params?.beforeRequest?.(url, options);
    const authNonSecuredCookie =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('auth='))
            ?.split('=')[1];

    const authNonSecuredOrg =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('showorg='))
            ?.split('=')[1];

    const authNonSecuredImpersonate =
      typeof document === 'undefined'
        ? null
        : document.cookie
            .split(';')
            .find((p) => p.includes('impersonate='))
            ?.split('=')[1];

    // Only impose our timeout when the caller isn't already managing its own
    // AbortSignal (e.g. the design refine panel cancels in-flight requests) —
    // overriding it would break their cancellation.
    const callerSignal =
      (newRequestObject as RequestInit | undefined)?.signal ?? options.signal;
    const controller = callerSignal ? undefined : new AbortController();
    const timeout = controller
      ? setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
      : undefined;

    let fetchRequest: Response;
    try {
      fetchRequest = await fetch(params.baseUrl + url, {
        ...(secured ? { credentials: 'include' } : {}),
        ...(newRequestObject || options),
        headers: {
          ...(showorg
            ? { showorg }
            : authNonSecuredOrg
            ? { showorg: authNonSecuredOrg }
            : {}),
          ...(options.body instanceof FormData
            ? {}
            : { 'Content-Type': 'application/json' }),
          Accept: 'application/json',
          ...options?.headers,
          ...(auth
            ? { auth }
            : authNonSecuredCookie
            ? { auth: authNonSecuredCookie }
            : {}),
          ...(authNonSecuredImpersonate
            ? { impersonate: authNonSecuredImpersonate }
            : {}),
        },
        // @ts-ignore
        ...(!options.next && options.cache !== 'force-cache'
          ? { cache: options.cache || 'no-store' }
          : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (e) {
      if (controller?.signal.aborted) {
        throw new FetchTimeoutError(url);
      }
      throw e;
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }

    if (
      !params?.afterRequest ||
      (await params?.afterRequest?.(url, options, fetchRequest))
    ) {
      return fetchRequest;
    }

    // 402/406 was handled globally by the trial/payment dialog. Reject with a
    // marker (instead of a promise that never resolves) so the caller's
    // finally/catch can clear its loading state; GlobalErrorLogger swallows it.
    return Promise.reject(new FetchHandledError(fetchRequest.status));
  };
};

export const fetchBackend = customFetch({
  get baseUrl() {
    return process.env.BACKEND_URL!;
  },
});
