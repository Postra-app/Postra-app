import { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import { runWithAuditActor } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.actor';

// E2E-09-35: audit rows were written with the user from the request, which
// during impersonation is the *target*. Every action an admin took while
// wearing someone's identity was filed against that person. The sharpest case
// is chaining — admin impersonates A, and from that session impersonates B, so
// the row read "A impersonated B".

const create = jest.fn().mockResolvedValue({});
const service = () =>
  new AuditService({ model: { auditLog: { create } } } as any);

const written = () => create.mock.calls[0][0].data;

describe('who an audit row names', () => {
  it('names the caller when nobody is impersonating', async () => {
    await runWithAuditActor({ userId: 'admin-1' }, () =>
      service().record({ action: 'admin.grant-lifetime', userId: 'admin-1' })
    );

    expect(written().userId).toBe('admin-1');
    expect(written().metadata?.impersonatedUserId).toBeUndefined();
  });

  it('names the admin, not the customer, while impersonating', async () => {
    await runWithAuditActor(
      { userId: 'admin-1', impersonatedUserId: 'customer-9' },
      () =>
        // What the call site passes is the target — that is the whole bug.
        service().record({
          action: 'security.apikey.rotate',
          userId: 'customer-9',
        })
    );

    expect(written().userId).toBe('admin-1');
    expect(written().metadata.impersonatedUserId).toBe('customer-9');
  });

  it('records both ends of a chained impersonation', async () => {
    await runWithAuditActor(
      { userId: 'admin-1', impersonatedUserId: 'user-a' },
      () =>
        service().record({
          action: 'admin.impersonate',
          userId: 'user-a',
          metadata: { impersonatedUserOrg: 'org-b' },
        })
    );

    const row = written();
    expect(row.userId).toBe('admin-1');
    expect(row.metadata.impersonatedUserId).toBe('user-a');
    expect(row.metadata.impersonatedUserOrg).toBe('org-b');
  });

  it('fills the ip and user agent the columns always had and nothing wrote', async () => {
    await runWithAuditActor(
      { userId: 'admin-1', ip: '203.0.113.7', userAgent: 'Chrome/140' },
      () => service().record({ action: 'auth.login' })
    );

    expect(written().ip).toBe('203.0.113.7');
    expect(written().userAgent).toBe('Chrome/140');
  });

  it('survives a write made outside any request', async () => {
    await service().record({ action: 'subscription.change' });
    expect(written().userId).toBeUndefined();
  });

  it('reaches a write that happens after an await', async () => {
    await runWithAuditActor(
      { userId: 'admin-1', impersonatedUserId: 'customer-9' },
      async () => {
        await Promise.resolve();
        await service().record({ action: 'integration.connect' });
      }
    );

    expect(written().userId).toBe('admin-1');
  });
});
