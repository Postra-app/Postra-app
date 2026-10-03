import { organizationRegion } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.repository';

describe('organizationRegion', () => {
  it('defaults a sign-up without a region to the UK', () => {
    expect(organizationRegion(undefined)).toBe('UK');
    expect(organizationRegion('')).toBe('UK');
    expect(organizationRegion('XX')).toBe('UK');
  });

  it('keeps an explicit region', () => {
    expect(organizationRegion('UK')).toBe('UK');
    expect(organizationRegion('PL')).toBe('PL');
  });
});
