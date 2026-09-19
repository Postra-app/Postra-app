// The controller pulls in IntegrationManager, which reaches every provider —
// including nostr-tools, whose ESM build jest does not parse. Nothing here
// touches a provider.
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: { sanitize: (v: string) => v },
}));

const store = new Map<string, string>();
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
  },
}));

import { NoAuthIntegrationsController } from './no.auth.integrations.controller';

/**
 * ⛔ E2E-10-70 — the app could not connect a single channel.
 *
 * The OAuth provider redirects the *browser* to the callback page, and that
 * page POSTs `/integrations/social-connect/:provider`. On a phone the browser
 * carries no Postra session (the app holds a token in secure storage, not a
 * cookie), so the POST answered `401 "You must be signed in to connect a
 * channel"` — measured on production 2026-09-19, and the gate fires *before*
 * the code is exchanged, so genuine consent at the provider changed nothing.
 *
 * ⛔ Relaxing that gate was never the answer: it is what stops an attacker
 * minting a `state` for their own organisation and having a victim's channel
 * connected into it. This route is the other way out — it tells the callback
 * page that the flow belongs to the app, so the page bounces `state`/`code`
 * back over `postra://` and the app finishes the exchange with the token it
 * already holds, passing the very same gate legitimately.
 */
const build = () =>
  new NoAuthIntegrationsController(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

describe('GET /integrations/social-connect/:integration/handoff', () => {
  beforeEach(() => store.clear());

  it('hands an app-started flow back to the app scheme', async () => {
    store.set('redirect:st-1', 'postra://integrations');
    await expect(build().getConnectHandoff('st-1')).resolves.toEqual({
      handoff: true,
      url: 'postra://integrations',
    });
  });

  it('leaves a browser-started flow alone', async () => {
    store.set('redirect:st-2', 'https://app.postra.pl/launches');
    await expect(build().getConnectHandoff('st-2')).resolves.toEqual({
      handoff: false,
    });
  });

  it('says no when the flow stored no return url at all', async () => {
    await expect(build().getConnectHandoff('st-unknown')).resolves.toEqual({
      handoff: false,
    });
  });

  it('says no without a state instead of reading Redis', async () => {
    await expect(build().getConnectHandoff('')).resolves.toEqual({
      handoff: false,
    });
    await expect(build().getConnectHandoff(undefined as any)).resolves.toEqual({
      handoff: false,
    });
  });

  /**
   * ⚠️ The callback page navigates to whatever comes back here, so the answer
   * is an allowlist of one scheme rather than "anything that is not http".
   * `redirectUrl` reaches Redis from an authenticated caller, so this cannot be
   * aimed at someone else's account — but it keeps the page from becoming a
   * general-purpose redirector.
   */
  it.each([
    'evil://steal',
    'javascript:alert(1)',
    'postra-evil://integrations',
    'http://app.postra.pl/launches',
    '//evil.example',
  ])('refuses to hand off to %s', async (url) => {
    store.set('redirect:st-3', url);
    await expect(build().getConnectHandoff('st-3')).resolves.toEqual({
      handoff: false,
    });
  });

  it('does not consume the state — the POST still needs it', async () => {
    store.set('redirect:st-4', 'postra://integrations');
    await build().getConnectHandoff('st-4');
    expect(store.get('redirect:st-4')).toBe('postra://integrations');
  });
});
