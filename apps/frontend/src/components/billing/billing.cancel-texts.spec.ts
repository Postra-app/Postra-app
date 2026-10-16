import { readFileSync } from 'fs';
import { join } from 'path';

// Texts approved by K. 2026-10-16 (upstream a36eada0a, 97d14d013):
// - the cancel dialog paired "Yes, cancel" with the default "No, cancel!",
//   two buttons that both read as cancelling;
// - "may be removed" was wrong: reconcileTeamSeats disables members over the
//   new seat limit and enables them again on upgrade.
const source = readFileSync(join(__dirname, 'main.billing.component.tsx'), 'utf8');

describe('billing cancel texts', () => {
  it('the cancel dialog keeps the plan with "No, keep it"', () => {
    expect(source).toMatch(/'Yes, cancel',\s*'Cancel Subscription',\s*'No, keep it'/);
  });

  it('says members are disabled until an upgrade, not removed', () => {
    expect(source).toContain('Some team members will be disabled until you upgrade again');
    expect(source).not.toContain('may be removed');
  });
});
