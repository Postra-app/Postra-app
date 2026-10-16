jest.mock('isomorphic-dompurify', () => ({ __esModule: true, default: { sanitize: (v: string) => v } }));

import { InstagramProvider } from '@gitroom/nestjs-libraries/integrations/social/instagram.provider';

// Error 2207078: the account reached Instagram's Trial Reel publish limit.
// Without a mapping the user got Instagram's raw error (upstream 66d21018).
describe('InstagramProvider.handleErrors', () => {
  it('explains the Trial Reel publish limit', () => {
    const res = new InstagramProvider().handleErrors(
      JSON.stringify({ error: { error_subcode: 2207078 } }),
      400
    );
    expect(res?.type).toBe('bad-body');
    expect(res?.value).toMatch(/Trial Reel publish limit/);
  });
});

// Upstream c1fd5cffb, 454553c4f, 93b1a2a64, b95e1e2cb, 38918c2f9: errors that
// reached the user as "Unknown Error" or a bare status, and one transient
// fetch failure that failed the post instead of retrying.
describe('InstagramProvider.handleErrors (upstream 10-16)', () => {
  const handle = (subcode: number) =>
    new InstagramProvider().handleErrors(
      JSON.stringify({ error: { error_subcode: subcode } }),
      400
    );

  it('names the collaborator that could not be tagged (2207018)', () => {
    expect(handle(2207018)).toEqual({
      type: 'bad-body',
      value: expect.stringMatching(/collaborators could not be tagged/),
    });
  });

  it('says the post went out when only the comment was rejected (1772107)', () => {
    expect(handle(1772107)).toEqual({
      type: 'bad-body',
      value: expect.stringMatching(/the post itself was published/),
    });
  });

  it("points 2207053 at Instagram's video limits", () => {
    expect(handle(2207053)?.value).toMatch(/300MB, 1920px width, 25Mbps/);
  });

  it('retries a failed media fetch (2207052)', () => {
    expect(handle(2207052)?.type).toBe('retry');
  });
});

describe('InstagramProvider.failedContainer', () => {
  it('does not show a bare "ERROR" when Meta sends no detail', () => {
    expect(() => new InstagramProvider().failedContainer('ERROR', 'ERROR')).toThrow(
      'Instagram could not process the media'
    );
  });

  it('keeps a real reason from Meta', () => {
    expect(() =>
      new InstagramProvider().failedContainer('ERROR', 'Video too long')
    ).toThrow('Video too long');
  });
});
