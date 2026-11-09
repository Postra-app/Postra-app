import { cookies, headers } from 'next/headers';
import {
  cookieName,
  fallbackLng,
  headerName,
  languages,
} from '@gitroom/react/translation/i18n.config';

// The language a page renders in: the visitor's explicit choice (cookie)
// first, else the device language proxy.ts resolved from Accept-Language, so a
// first-time visitor renders in their language. Every layout uses it: useT
// renders it on the server and the browser starts on it, and a layout that
// hard-coded "en" also overwrote a Polish visitor's saved choice.
// A saved choice of a language no longer offered (de, fr… parked)
// falls back like an unknown one, instead of rendering a
// catalogue i18next does not load.
export async function requestLanguage() {
  const supported = (value?: string | null) =>
    value && languages.includes(value) ? value : undefined;
  return (
    supported((await cookies()).get(cookieName)?.value) ||
    supported((await headers()).get(headerName)) ||
    fallbackLng
  );
}
