jest.mock('@gitroom/backend/services/auth/permissions/permissions.service', () => ({
  PermissionsService: class {},
}));

import { isUnguardedPath } from './permissions.guard';

// E2E-08-25: the guard skipped every path containing "/auth", so approving an
// OAuth app (`/oauth/authorize`) ran without its admin-only policy.
describe('isUnguardedPath', () => {
  it('skips sign-in routes and the channel-connect callbacks', () => {
    for (const path of ['/auth/login', '/auth/oauth/google/exists', '/integrations/social-connect/x', '/integrations/provider/1/connect']) {
      expect(isUnguardedPath(path)).toBe(true);
    }
  });

  it('checks everything else, whatever it contains', () => {
    for (const path of ['/oauth/authorize', '/oauth/token', '/settings/team/auth', '/user/oauth-app', '/posts/authors']) {
      expect(isUnguardedPath(path)).toBe(false);
    }
  });
});
