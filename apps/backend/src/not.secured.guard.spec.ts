import { assertNotSecuredOnlyOverHttp } from './not.secured.guard';

describe('assertNotSecuredOnlyOverHttp', () => {
  it('refuses NOT_SECURED on an https deployment', () => {
    expect(() =>
      assertNotSecuredOnlyOverHttp({
        NOT_SECURED: 'true',
        FRONTEND_URL: 'https://app.postra.co.uk',
      })
    ).toThrow(/NOT_SECURED/);
  });

  it('allows it for local http development and the test stack', () => {
    expect(() =>
      assertNotSecuredOnlyOverHttp({
        NOT_SECURED: 'true',
        FRONTEND_URL: 'http://localhost:54000',
      })
    ).not.toThrow();
  });

  it('does nothing when it is not set', () => {
    expect(() =>
      assertNotSecuredOnlyOverHttp({ FRONTEND_URL: 'https://app.postra.co.uk' })
    ).not.toThrow();
  });
});
