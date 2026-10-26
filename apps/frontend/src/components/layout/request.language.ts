import { cookies, headers } from 'next/headers';
import {
  cookieName,
  fallbackLng,
  headerName,
} from '@gitroom/react/translation/i18n.config';

// The language a page renders in: the visitor's explicit choice (cookie)
// first, else the device language proxy.ts resolved from Accept-Language, so a
// first-time visitor renders in their language. Every layout uses it: useT
// renders it on the server and the browser starts on it, and a layout that
// hard-coded "en" also overwrote a Polish visitor's saved choice.
export async function requestLanguage() {
  return (
    (await cookies()).get(cookieName)?.value ||
    (await headers()).get(headerName) ||
    fallbackLng
  );
}
