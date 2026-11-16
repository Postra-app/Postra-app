import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { initReactI18next } from 'react-i18next/initReactI18next';
import { fallbackLng, languages, defaultNS } from './i18n.config';
const runsOnServerSide = typeof window === 'undefined';

i18next
  .use(initReactI18next)
  .use(LanguageDetector)
  .use(
    resourcesToBackend((language: any, namespace: any) => {
      return import(`./locales/${language}/${namespace}.json`);
    })
  )
  .init({
    supportedLngs: languages,
    fallbackLng,
    lng: undefined,
    fallbackNS: defaultNS,
    defaultNS,
    // Map regional tags (en-GB, pl-PL) to base language (en, pl).
    load: 'languageOnly',
    detection: {
      // cookie  = explicit user choice, always wins.
      // header  = SSR value resolved by proxy.ts from Accept-Language.
      // navigator = the visitor's device/browser language on the client
      //            (the only detector that fires in the browser when no cookie).
      order: ['cookie', 'header', 'navigator'],
      // Persist the detected language so the choice sticks across visits.
      caches: ['cookie'],
    },
    preload: runsOnServerSide ? languages : [],
    // React escapes what it renders. Escaped here as well, a value came out
    // twice escaped and people read the entities: a date as
    // 16&#x2F;11&#x2F;2026, a name with "&" as "&amp;". No translated text is
    // put into the page as raw HTML.
    interpolation: { escapeValue: false },
  });

export default i18next;
