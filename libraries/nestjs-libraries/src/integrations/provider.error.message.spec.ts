/**
 * E2E-05-14 — a provider without its own handleErrors (Mastodon) turned
 * "Cannot attach more than four files" into "Unknown Error" in the failure
 * email and in-app notification.
 */
jest.mock('nostr-tools', () => ({
  getPublicKey: jest.fn(),
  Relay: class {},
  finalizeEvent: jest.fn(),
  SimplePool: class {},
}));

import { providerErrorMessage } from '@gitroom/nestjs-libraries/integrations/social.abstract';

describe('providerErrorMessage', () => {
  it('reads Mastodon {"error": "..."}', () => {
    expect(
      providerErrorMessage('{"error":"Cannot attach more than four files"}')
    ).toBe('Cannot attach more than four files');
  });

  it('prefers Meta error_user_msg over the technical message', () => {
    expect(
      providerErrorMessage(
        '{"error":{"message":"(#100) Invalid parameter","error_user_msg":"The image is too small"}}'
      )
    ).toBe('The image is too small');
  });

  it('reads X-style errors[0].message and detail', () => {
    expect(providerErrorMessage('{"errors":[{"message":"Too many media"}]}')).toBe(
      'Too many media'
    );
    expect(providerErrorMessage('{"detail":"Forbidden"}')).toBe('Forbidden');
  });

  it('masks secrets and caps the length', () => {
    const out = providerErrorMessage(
      JSON.stringify({ message: 'bad access_token=abc123 ' + 'x'.repeat(500) })
    )!;
    expect(out).toContain('access_token=***');
    expect(out).not.toContain('abc123');
    expect(out.length).toBeLessThanOrEqual(300);
  });

  it('gives up on bodies it cannot read, so the caller falls back', () => {
    expect(providerErrorMessage('<html>502</html>')).toBeUndefined();
    expect(providerErrorMessage('{}')).toBeUndefined();
    expect(providerErrorMessage('{"error":{}}')).toBeUndefined();
  });
});
