import countries from 'i18n-iso-countries';
import countriesEn from 'i18n-iso-countries/langs/en.json';

countries.registerLocale(countriesEn);

// Flags come from our own /public/flags (copied from the flag-icons package,
// MIT, pinned in package.json and checked by flags.spec.ts). The component's
// default loads them from cdn.jsdelivr.net on every page: a third-party
// request with the visitor's IP that nothing in the privacy policy named,
// and a dependency on someone else's CDN for the top bar.
export const FLAGS_URL = '/flags/';

export const getCountryCodeForFlag = (languageCode: string) => {
  // For multi-region languages, here are some common defaults
  if (languageCode === 'en') return 'GB';
  if (languageCode === 'es') return 'ES';
  if (languageCode === 'ar') return 'SA';
  if (languageCode === 'zh') return 'CN';
  if (languageCode === 'he') return 'IL';
  if (languageCode === 'ja') return 'JP';
  if (languageCode === 'ko') return 'KR';
  if (languageCode === 'vi') return 'VN';

  // Check if language code itself is a valid country code
  try {
    const countryName = countries.getName(languageCode.toUpperCase(), 'en');
    if (countryName) {
      return languageCode.toUpperCase();
    }
  } catch (e) {
    // Not a valid country code, continue to next approach
  }

  // Try to extract region code if language code has a region component (e.g., en-US)
  const parts = languageCode.split('-');
  if (parts.length > 1) {
    const regionCode = parts[1].toUpperCase();
    try {
      const countryName = countries.getName(regionCode, 'en');
      if (countryName) {
        return regionCode;
      }
    } catch (e) {
      // Not a valid country code, continue to next approach
    }
  }

  // For most language codes that match their primary country
  // Examples: fr->FR, it->IT, de->DE, etc.
  return languageCode.toUpperCase();
};
