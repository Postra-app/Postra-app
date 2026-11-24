// The campaign a sign-up came from: the utm_source, utm_medium and
// utm_campaign of the link that led to the sign-up page. Kept only as short
// labels such as "facebook" or "spring-sale". Anything else (a URL, a click
// id, free text) is dropped, and a dropped value never stops a sign-up.

export type SignupSource = {
  signupSource?: string;
  signupMedium?: string;
  signupCampaign?: string;
};

export const SIGNUP_SOURCE_MAX = 64;

// Each field of the sign-up request and the URL parameter it is read from.
export const SIGNUP_SOURCE_PARAMS = {
  signupSource: 'utm_source',
  signupMedium: 'utm_medium',
  signupCampaign: 'utm_campaign',
} as const;

const SAFE = /^[a-z0-9._-]+$/;

// Trimmed and lower-cased; undefined when it is missing, longer than 64
// characters or has a character outside a-z, 0-9, dot, underscore and hyphen.
export const cleanSignupValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const clean = value.trim().toLowerCase();
  return clean.length <= SIGNUP_SOURCE_MAX && SAFE.test(clean)
    ? clean
    : undefined;
};

// The three values out of any object that may carry them, cleaned; a field
// without a usable value is left out.
export const cleanSignupSource = (from?: {
  [K in keyof SignupSource]?: unknown;
} | null): SignupSource => {
  const out: SignupSource = {};
  for (const key of Object.keys(SIGNUP_SOURCE_PARAMS) as Array<
    keyof SignupSource
  >) {
    const clean = cleanSignupValue(from?.[key]);
    if (clean) {
      out[key] = clean;
    }
  }
  return out;
};

// Read from URL parameters (utm_source, utm_medium, utm_campaign). Click ids
// and every other parameter are ignored.
export const signupSourceFromParams = (
  params?: { get(name: string): unknown } | Record<string, unknown> | null
): SignupSource => {
  const read = (name: string) =>
    typeof (params as any)?.get === 'function'
      ? (params as any).get(name)
      : (params as any)?.[name];
  return cleanSignupSource({
    signupSource: read(SIGNUP_SOURCE_PARAMS.signupSource),
    signupMedium: read(SIGNUP_SOURCE_PARAMS.signupMedium),
    signupCampaign: read(SIGNUP_SOURCE_PARAMS.signupCampaign),
  });
};

// The same three values as a query string for a request, '' when there are
// none.
export const signupSourceQuery = (source: SignupSource): string => {
  const query = new URLSearchParams();
  for (const [key, param] of Object.entries(SIGNUP_SOURCE_PARAMS)) {
    const value = source[key as keyof SignupSource];
    if (value) {
      query.set(param, value);
    }
  }
  const text = query.toString();
  return text ? `?${text}` : '';
};
