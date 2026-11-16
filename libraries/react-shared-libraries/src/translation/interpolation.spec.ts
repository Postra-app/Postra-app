import i18next from './i18next';

// i18next escapes interpolated values as HTML unless told not to. Everything
// here is rendered by React, which escapes on its own, so a value was escaped
// twice and people read the entities: the "date has passed" question showed
// 16&#x2F;11&#x2F;2026, and a workspace called "Tom & Co" would be "Tom &amp; Co".
describe('interpolated values are shown as they are', () => {
  beforeAll(async () => {
    if (!i18next.isInitialized) {
      await new Promise((resolve) => i18next.on('initialized', resolve));
    }
  });

  it('a date keeps its slashes', () => {
    expect(
      i18next.t('test_only_date', 'The publish date {{date}} is in the past', {
        date: '16/11/2026 09:00',
      })
    ).toBe('The publish date 16/11/2026 09:00 is in the past');
  });

  it('a name keeps its ampersand, apostrophe and brackets', () => {
    expect(
      i18next.t('test_only_name', 'Join {{name}}?', { name: `Tom & Co's <Team>` })
    ).toBe(`Join Tom & Co's <Team>?`);
  });
});
