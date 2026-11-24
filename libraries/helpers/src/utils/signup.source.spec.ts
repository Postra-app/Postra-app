import {
  cleanSignupSource,
  cleanSignupValue,
  signupSourceFromParams,
  signupSourceQuery,
} from '@gitroom/helpers/utils/signup.source';

// The campaign a sign-up came from is kept as short labels only. Anything
// that could be a URL, a click id or free text is dropped rather than stored.
describe('cleanSignupValue', () => {
  it.each(['facebook', 'spring-sale_2026', 'news.letter', 'a'])(
    'keeps a short label (%s)',
    (value) => {
      expect(cleanSignupValue(value)).toBe(value);
    }
  );

  it('trims and lower-cases', () => {
    expect(cleanSignupValue('  FaceBook ')).toBe('facebook');
  });

  it('keeps 64 characters and drops 65', () => {
    expect(cleanSignupValue('a'.repeat(64))).toBe('a'.repeat(64));
    expect(cleanSignupValue('a'.repeat(65))).toBeUndefined();
  });

  it.each([
    'https://example.com/?a=1',
    'spring sale',
    'name@example.com',
    'a&check=forged',
    '<script>',
    'zażółć',
    '',
    '   ',
  ])('drops a value with other characters (%j)', (value) => {
    expect(cleanSignupValue(value)).toBeUndefined();
  });

  it.each([undefined, null, 7, ['facebook'], { a: 1 }])(
    'drops what is not a string (%j)',
    (value) => {
      expect(cleanSignupValue(value)).toBeUndefined();
    }
  );
});

describe('cleanSignupSource', () => {
  it('keeps the good fields and leaves out the others', () => {
    expect(
      cleanSignupSource({
        signupSource: 'Facebook',
        signupMedium: 'paid social',
        signupCampaign: 'launch-week',
      })
    ).toEqual({ signupSource: 'facebook', signupCampaign: 'launch-week' });
  });

  it('is empty for nothing', () => {
    expect(cleanSignupSource(undefined)).toEqual({});
    expect(cleanSignupSource(null)).toEqual({});
    expect(cleanSignupSource({})).toEqual({});
  });
});

describe('signupSourceFromParams', () => {
  it('reads the three utm parameters and ignores click ids', () => {
    const params = new URLSearchParams(
      'utm_source=Facebook&utm_medium=cpc&utm_campaign=launch&fbclid=abc&gclid=def&utm_content=video'
    );
    expect(signupSourceFromParams(params)).toEqual({
      signupSource: 'facebook',
      signupMedium: 'cpc',
      signupCampaign: 'launch',
    });
  });

  it('reads a plain query object, and drops a repeated parameter', () => {
    expect(
      signupSourceFromParams({
        utm_source: 'google',
        utm_medium: ['cpc', 'email'],
      })
    ).toEqual({ signupSource: 'google' });
  });

  it('writes the same parameters back for a request', () => {
    expect(
      signupSourceQuery({ signupSource: 'facebook', signupCampaign: 'launch' })
    ).toBe('?utm_source=facebook&utm_campaign=launch');
    expect(signupSourceQuery({})).toBe('');
  });
});
