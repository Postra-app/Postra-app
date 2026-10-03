import { OrganizationRepository } from './organization.repository';

// A seat disabled by a downgrade, or a suspended account, kept receiving the
// organisation's mail (failure mails carry post content).
describe('who gets the organisation\'s mail', () => {
  it('only members with an active seat and an account that is not suspended', async () => {
    const findUnique = jest.fn().mockResolvedValue({ users: [] });
    const repo = Object.create(OrganizationRepository.prototype);
    Object.assign(repo, { _organization: { model: { organization: { findUnique } } } });

    await repo.getAllUsersOrgs('org-1');

    const users = findUnique.mock.calls[0][0].select.users;
    expect(users.where).toEqual({ disabled: false, user: { suspendedAt: null } });
    expect(users.select.user.select).toMatchObject({ email: true, sendSuccessEmails: true, sendFailureEmails: true });
  });
});
