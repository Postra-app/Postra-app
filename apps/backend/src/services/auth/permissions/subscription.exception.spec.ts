import { getErrorMessage } from './subscription.exception';
import {
  AuthorizationActions,
  PermissionDeniedException,
  Sections,
  SubscriptionException,
} from '@gitroom/nestjs-libraries/services/auth/permission.exception.class';

// Regression guard for e2e/bugs.md E2E-02-02. getErrorMessage used to switch on
// four quota sections with no default, so a denial on ADMIN / AI / AUTOPOST /
// TEAM_MEMBERS returned undefined — JSON.stringify dropped the key and the
// client got `{statusCode: 402, url}` with nothing to show the user.
describe('permission denials', () => {
  it('never maps a section to undefined', () => {
    for (const section of Object.values(Sections)) {
      for (const action of Object.values(AuthorizationActions)) {
        const message = getErrorMessage({ section, action });
        expect(typeof message).toBe('string');
        expect(message!.length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the quota wording that names the limit that was hit', () => {
    expect(getErrorMessage({
      section: Sections.CHANNEL,
      action: AuthorizationActions.Create,
    })).toContain('channels');
    expect(getErrorMessage({
      section: Sections.WEBHOOKS,
      action: AuthorizationActions.Create,
    })).toContain('webhooks');
  });

  it('tells an Auto Post denial which plans include it, not "not in your plan"', () => {
    const message = getErrorMessage({
      section: Sections.AUTOPOST,
      action: AuthorizationActions.Create,
    });
    expect(message).toContain('Pro (3 RSS feeds)');
    expect(message).toContain('Business (10)');
  });

  // Authority vs entitlement: money fixes one and not the other, so they must
  // not share a status code.
  it('answers 403 for a role denial and 402 for a plan limit', () => {
    const denial = { action: AuthorizationActions.Create } as const;
    expect(
      new PermissionDeniedException({ ...denial, section: Sections.ADMIN }).getStatus()
    ).toBe(403);
    expect(
      new SubscriptionException({ ...denial, section: Sections.CHANNEL }).getStatus()
    ).toBe(402);
  });
});
