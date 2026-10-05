import { isOtherOrg } from './org.broadcast';

describe('following an organisation switch made in another tab (E2E-08-35)', () => {
  it('reloads only when the other tab moved to a different organisation', () => {
    expect(isOtherOrg('org-b:1700000000000', 'org-a')).toBe(true);
    expect(isOtherOrg('org-a:1700000000000', 'org-a')).toBe(false);
    expect(isOtherOrg(null, 'org-a')).toBe(false);
  });
});
