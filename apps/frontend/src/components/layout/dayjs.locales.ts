import dayjs from 'dayjs';
import i18next from '@gitroom/react/translation/i18next';
import localeEn from 'dayjs/locale/en';
import localeEnGb from 'dayjs/locale/en-gb';
import localePl from 'dayjs/locale/pl';
import localeHe from 'dayjs/locale/he';
import localeRu from 'dayjs/locale/ru';
import localeZh from 'dayjs/locale/zh';
import localeFr from 'dayjs/locale/fr';
import localeEs from 'dayjs/locale/es';
import localePt from 'dayjs/locale/pt';
import localeDe from 'dayjs/locale/de';
import localeIt from 'dayjs/locale/it';
import localeJa from 'dayjs/locale/ja';
import localeKo from 'dayjs/locale/ko';
import localeAr from 'dayjs/locale/ar';
import localeTr from 'dayjs/locale/tr';
import localeVi from 'dayjs/locale/vi';

// Postra is UK-first: English dates read the British way. dayjs's "en" is
// American ("L" = 11/09/2026 for 9 November, E2E-11-342); its date formats
// come from "en-gb" here. Only the formats: the first day of the week stays
// what the calendar is built on.
export const localeEnUk = { ...localeEn, formats: localeEnGb.formats };

let registered = false;

/**
 * Dates in the interface's language on every page.
 *
 * This lived in the calendar module, so a page that never loaded the
 * calendar (Billing) formatted its dates in English: "Zmiana na Starter od
 * 23 November". Called from the root layout. Bare side-effect imports of
 * dayjs locales are dropped from the production bundle; referencing the
 * locale objects keeps their data in it.
 */
export const registerDayjsLocales = () => {
  if (registered) return;
  registered = true;
  [
    localeEnUk, localePl, localeHe, localeRu, localeZh, localeFr, localeEs,
    localePt, localeDe, localeIt, localeJa, localeKo, localeAr, localeTr,
    localeVi,
  ].forEach((locale) => dayjs.locale(locale.name, locale, true));
  const follow = () => dayjs.locale(i18next.resolvedLanguage || 'en');
  i18next.on('languageChanged', follow);
  follow();
};
