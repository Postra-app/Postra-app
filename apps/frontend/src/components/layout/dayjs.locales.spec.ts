import dayjs from 'dayjs';
import i18next from '@gitroom/react/translation/i18next';
import { registerDayjsLocales } from './dayjs.locales';

// Billing in Polish read "Zmiana na Starter od 23 November": only the
// calendar module set the dates' language.
describe('dates in the interface language', () => {
  afterAll(async () => {
    await i18next.changeLanguage('en');
  });

  it('follow a change to Polish on any page', async () => {
    registerDayjsLocales();
    await i18next.changeLanguage('pl');
    expect(dayjs('2026-11-23').format('D MMMM YYYY')).toBe('23 listopada 2026');
    await i18next.changeLanguage('en');
    expect(dayjs('2026-11-23').format('D MMMM YYYY')).toBe('23 November 2026');
  });
});
