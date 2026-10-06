import { pkceMatches } from './oauth.service';

// E2E-08-44: the metadata promised PKCE (S256) and /oauth/token never looked
// at code_verifier. Vector from RFC 7636 Appendix B.
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

it('S256: the verifier from RFC 7636 Appendix B matches its challenge', () => {
  expect(pkceMatches(challenge, verifier)).toBe(true);
});

it('a code asked for with a challenge needs its own verifier', () => {
  expect(pkceMatches(challenge, undefined)).toBe(false);
  expect(pkceMatches(challenge, verifier.replace('d', 'e'))).toBe(false);
  // `plain` is not offered: the challenge itself is not a verifier.
  expect(pkceMatches(challenge, challenge)).toBe(false);
});

it('without a challenge, no verifier is taken', () => {
  expect(pkceMatches(null, undefined)).toBe(true);
  expect(pkceMatches(null, verifier)).toBe(false);
});
