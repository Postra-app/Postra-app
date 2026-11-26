import { cancelTrialQuestion, planButtonLabel } from './trial.plan.texts';

const t = (_key: string, text: string) => text;

// On a trial the Billing page spoke as if a subscription was being paid for:
// "Purchase plan (Pay Today £0.00)" on a button that only changes the plan
// tried, and "Are you sure you want to cancel your subscription?".
describe('Billing texts during the free trial', () => {
  it('the cancel question says the trial stays to its end and nothing is charged', () => {
    expect(cancelTrialQuestion(Date.UTC(2026, 11, 1, 15, 20))).toBe(
      'Cancel your free trial? It stays until 1 December and nothing is charged.'
    );
  });

  it('the cancel question still makes sense without the date', () => {
    expect(cancelTrialQuestion(undefined)).toBe(
      'Cancel your free trial? It stays until its last day and nothing is charged.'
    );
  });

  it('another plan is switched to on a trial and purchased otherwise', () => {
    expect(planButtonLabel(true, t)).toBe('Switch to this plan');
    expect(planButtonLabel(false, t)).toBe('Purchase plan');
  });
});
