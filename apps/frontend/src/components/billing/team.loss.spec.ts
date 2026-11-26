import { losesTeamMembers } from './team.loss';

// The change-plan and cancel dialogs warn that team members are disabled when
// the new plan seats fewer people. On a trial that was said too ("Some team
// members will be disabled until you upgrade again" when moving a Pro trial to
// Starter), although the trial is for one person on every plan.
describe('the team members warning on a change of plan', () => {
  it('warns when a paid plan moves to one with fewer seats', () => {
    expect(losesTeamMembers(false, 'PRO', 'STANDARD')).toBe(true);
    expect(losesTeamMembers(false, 'ULTIMATE', 'FREE')).toBe(true);
  });

  it('does not warn when the seats stay or grow', () => {
    expect(losesTeamMembers(false, 'STANDARD', 'PRO')).toBe(false);
    expect(losesTeamMembers(false, 'PRO', 'PRO')).toBe(false);
    expect(losesTeamMembers(false, undefined, 'STANDARD')).toBe(false);
  });

  it('never warns during a trial', () => {
    expect(losesTeamMembers(true, 'PRO', 'STANDARD')).toBe(false);
    expect(losesTeamMembers(true, 'ULTIMATE', 'FREE')).toBe(false);
  });
});
