import { sameOriginGuard } from './same.origin.guard';

const run = (req: any) => {
  const next = jest.fn();
  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(() => res),
  };
  sameOriginGuard(['https://app.postra.co.uk'])(req, res, next);
  return { next, res };
};

const browser = (extra: any = {}) => ({
  method: 'POST',
  headers: { origin: 'https://evil.example' },
  cookies: { auth: 'jwt' },
  ...extra,
});

/**
 * §48 (2026-10-27) — the session cookie (SameSite=Lax) was Postra's only
 * defence against cross-site request forgery; OWASP counts SameSite as a
 * second layer, not the first. A browser names the page a request comes from
 * in `Origin`, and a request riding the session cookie from any other page is
 * refused.
 */
describe('sameOriginGuard', () => {
  it('refuses a cookie-authenticated change from another site', () => {
    const { next, res } = run(browser());
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('lets the app itself through', () => {
    const { next } = run(browser({ headers: { origin: 'https://app.postra.co.uk' } }));
    expect(next).toHaveBeenCalled();
  });

  it('leaves reads alone', () => {
    expect(run(browser({ method: 'GET' })).next).toHaveBeenCalled();
    expect(run(browser({ method: 'OPTIONS' })).next).toHaveBeenCalled();
  });

  it('leaves token clients alone (mobile app, server-side fetches, API keys)', () => {
    expect(
      run(browser({ headers: { origin: 'https://evil.example', auth: 'jwt' } })).next
    ).toHaveBeenCalled();
  });

  it('leaves requests without the session cookie alone (webhooks, OAuth callbacks)', () => {
    expect(run(browser({ cookies: {} })).next).toHaveBeenCalled();
  });

  it('does not invent a refusal when the browser sent no Origin', () => {
    expect(run(browser({ headers: {} })).next).toHaveBeenCalled();
  });
});
