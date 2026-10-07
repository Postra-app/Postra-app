import { OrganizationRepository } from './organization.repository';

// Impersonation loads its target through getUserOrg, before the middleware's
// own activated and disabled checks run. A deactivated account, or a seat
// disabled after a downgrade, was fully usable that way, publishing included
// (E2E-09-27). No match leaves the admin as themselves.
describe('the impersonation target', () => {
  it('is only an active seat of an activated account', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const repo = Object.create(OrganizationRepository.prototype);
    Object.assign(repo, {
      _userOrg: { model: { userOrganization: { findFirst } } },
    });

    expect(await repo.getUserOrg('uo-1')).toBeNull();
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: 'uo-1',
      disabled: false,
      user: { activated: true },
    });
  });
});
