// Default/UK-first language is English. Polish (and others) are still
// auto-detected per-user from the browser / Accept-Language and the in-app
// switcher — language is per-USER, not per-domain.
export const fallbackLng = 'en';
// Only complete languages are offered or detected.
// The other catalogues held 686 of 1972 texts, so a visitor whose browser
// asked for German got a German-English mix on every screen.
export const languages = [fallbackLng, 'pl'];

// Catalogues kept in the repository but not loaded until they are complete.
// locales.spec.ts checks that
// every folder is in one of the two lists.
export const parkedLanguages = [
  'he',
  'ru',
  'zh',
  'fr',
  'es',
  'pt',
  'de',
  'it',
  'ja',
  'ko',
  'ar',
  'tr',
  'vi',
];

export const defaultNS = 'translation';
export const cookieName = 'i18next';
export const headerName = 'x-i18next-current-language';
