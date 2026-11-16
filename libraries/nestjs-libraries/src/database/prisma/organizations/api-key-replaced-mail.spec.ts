import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

// E2E-11-362: once the key is replaced, the integrations of the organisation
// stop working. The owners and admins, the only ones who can fix them, are
// told why, by mail, and the audit trail says the replacement was automatic.
// The mail never carries the key.
describe('after the API key is replaced', () => {
  const build = (sendEmail = jest.fn().mockResolvedValue(undefined)) => {
    const repo = {
      getApiKeyHolders: jest.fn().mockResolvedValue([
        { id: 'owner', email: 'owner@example.com' },
        { id: 'admin-2', email: 'admin2@example.com' },
      ]),
    };
    const audit = { record: jest.fn() };
    const service = new OrganizationService(repo as any, { sendEmail } as any, audit as any);
    return { service, repo, audit, sendEmail };
  };

  it('mails every owner and admin who still sees the key, once, without the key', async () => {
    const { service, repo, sendEmail } = build();
    await service.afterApiKeyReplaced(['org-1'], 'admin-removed', 'gone');
    expect(repo.getApiKeyHolders).toHaveBeenCalledWith('org-1');
    expect(sendEmail.mock.calls.map(([to]: any) => to)).toEqual([
      'owner@example.com',
      'admin2@example.com',
    ]);
    const [, subject, html] = sendEmail.mock.calls[0];
    expect(subject).toBe('Your Postra API key was replaced');
    expect(html).toContain('An admin was removed from your Postra organisation.');
    expect(html).toContain('Settings, Developers');
    expect(html).not.toMatch(/[—–]/);
  });

  it('records one automatic rotation per organisation', async () => {
    const { service, audit } = build();
    await service.afterApiKeyReplaced(['org-1', 'org-2'], 'admin-suspended', 'u9');
    expect(audit.record.mock.calls.map(([e]: any) => e)).toEqual([
      {
        action: 'security.apikey.rotate',
        organizationId: 'org-1',
        metadata: { automatic: true, reason: 'admin-suspended', targetUserId: 'u9' },
      },
      {
        action: 'security.apikey.rotate',
        organizationId: 'org-2',
        metadata: { automatic: true, reason: 'admin-suspended', targetUserId: 'u9' },
      },
    ]);
  });

  it('a failing mail does not throw: the key is already replaced', async () => {
    const { service, sendEmail } = build(jest.fn().mockRejectedValue(new Error('SES down')));
    await expect(
      service.afterApiKeyReplaced(['org-1'], 'admin-demoted', 'u1')
    ).resolves.toBeUndefined();
    expect(sendEmail).toHaveBeenCalledTimes(2);
  });
});
