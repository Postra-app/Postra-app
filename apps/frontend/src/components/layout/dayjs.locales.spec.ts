import dayjs from 'dayjs';
import localizedFormat from 'dayjs/plugin/localizedFormat';
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

dayjs.extend(localizedFormat);

// E2E-11-342: the calendar header read "11/09/2026 - 11/15/2026" for 9 to 15
// November; a UK customer reads 11/09 as 11 September.
describe('English dates in Postra', () => {
  beforeAll(() => registerDayjsLocales());

  it('read day first, as in the UK', () => {
    const d = dayjs('2026-11-09T12:00:00').locale('en');
    expect(d.format('L')).toBe('09/11/2026');
    expect(d.format('dddd (L)')).toBe('Monday (09/11/2026)');
  });

  it('keep the first day of the week the calendar is built on', () => {
    expect(dayjs('2026-11-11T12:00:00').locale('en').startOf('week').format('YYYY-MM-DD')).toBe('2026-11-08');
  });

  it('leave other languages as they were', () => {
    expect(dayjs('2026-11-09T12:00:00').locale('pl').format('L')).toBe('09.11.2026');
  });
});
