import { codeOf } from '@gitroom/backend/api/routes/admin-mfa.controller';

// The body is not validated by a DTO here: an object with a broken toString
// reached String(code) and answered 500.
describe('the code in an admin two-factor request', () => {
  it('is a short string or a 400', () => {
    expect(codeOf('123456')).toBe('123456');
    for (const bad of [{ toString: null as unknown }, ['123456'], 123456, null, undefined, 'x'.repeat(65)]) {
      expect(() => codeOf(bad)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });
});
