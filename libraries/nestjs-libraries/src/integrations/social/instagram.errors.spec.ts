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
