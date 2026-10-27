import {
  clearImpersonateCookie,
  setImpersonateCookie,
} from './impersonate.cookie';

const fakeResponse = () => {
  const cookies: { name: string; options: any }[] = [];
  const res: any = {
    cookie: (name: string, _value: string, options: any) => {
      cookies.push({ name, options });
      return res;
    },
  };
  return { res, cookies };
};

/**
 * Codex 27 X on E2E-11-78: an impersonation started before cookies became
 * host-only left a domain-wide `impersonate` in the browser. "Stop" cleared
 * the host-only copy only, and the next request impersonated the customer
 * again from the old one.
 */
describe('impersonate cookie and the domain-wide leftover', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://app.postra.co.uk';
    delete process.env.NOT_SECURED;
  });
  afterAll(() => {
    process.env = env;
  });

  it('stopping expires the domain-wide copy too', () => {
    const { res, cookies } = fakeResponse();
    clearImpersonateCookie(res);
    const domains = cookies
      .filter((c) => c.name === 'impersonate')
      .map((c) => c.options.domain);
    expect(domains).toEqual(expect.arrayContaining([undefined, '.postra.co.uk']));
  });

  it('starting or renewing replaces a domain-wide copy with the host-only one', () => {
    const { res, cookies } = fakeResponse();
    setImpersonateCookie(res, 'uo-1');
    const legacy = cookies.find((c) => c.options.domain === '.postra.co.uk');
    expect(legacy?.options.expires.getTime()).toBe(0);
    const current = cookies.find((c) => c.options.domain === undefined);
    expect(current?.options.maxAge).toBeGreaterThan(0);
  });
});
