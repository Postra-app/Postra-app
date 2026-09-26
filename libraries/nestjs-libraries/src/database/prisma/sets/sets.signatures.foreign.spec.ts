/**
 * E2E-05-18 — measured on production 2026-09-26 with a second account:
 * - PUT /signatures/<another org's id> answered 200 and created a brand-new
 *   signature in the caller's org, made it the default;
 * - DELETE of another org's signature or set, POST/PUT /sets with another
 *   org's id, and a second DELETE of the same set were all 500s.
 * Nothing crossed orgs; the answers were wrong.
 */
import { NotFoundException } from '@nestjs/common';
import { SetsRepository } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.repository';
import { SetsService } from '@gitroom/nestjs-libraries/database/prisma/sets/sets.service';
import { SignatureRepository } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.repository';
import { SignatureService } from '@gitroom/nestjs-libraries/database/prisma/signatures/signature.service';

const model = (count: number) => ({
  updateMany: jest.fn().mockResolvedValue({ count }),
  deleteMany: jest.fn().mockResolvedValue({ count }),
  create: jest.fn().mockResolvedValue({ id: 'new-id' }),
  upsert: jest.fn(),
});

const sets = (count: number) => {
  const m = model(count);
  const repo = new SetsRepository({ model: { sets: m } } as any);
  return { m, service: new SetsService(repo) };
};
const signatures = (count: number) => {
  const m = model(count);
  const repo = new SignatureRepository({ model: { signatures: m } } as any);
  return { m, service: new SignatureService(repo) };
};

describe('sets', () => {
  it('404s an edit of a set that is not in this org, and creates nothing', async () => {
    const { m, service } = sets(0);
    await expect(
      service.createSet('org', { id: 'foreign', name: 'x', content: '{}' })
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(m.create).not.toHaveBeenCalled();
    expect(m.updateMany.mock.calls[0][0].where).toEqual({ id: 'foreign', organizationId: 'org' });
  });

  it('404s a delete of a foreign or already deleted set', async () => {
    const { service } = sets(0);
    await expect(service.deleteSet('org', 'gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('creates with a server id, never the client one', async () => {
    const { m, service } = sets(1);
    await service.createSet('org', { name: 'x', content: '{}' });
    expect(m.create.mock.calls[0][0].data.organizationId).toBe('org');
    expect(m.upsert).not.toHaveBeenCalled();
  });

  it('still edits its own set', async () => {
    const { service } = sets(1);
    await expect(
      service.createSet('org', { id: 'mine', name: 'x', content: '{}' })
    ).resolves.toEqual({ id: 'mine' });
  });
});

describe('signatures', () => {
  it('404s an edit of a foreign or deleted signature instead of creating one', async () => {
    const { m, service } = signatures(0);
    await expect(
      service.createOrUpdateSignature('org', { content: 'x', autoAdd: true }, 'foreign')
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(m.create).not.toHaveBeenCalled();
    // and no other signature lost its default
    expect(m.updateMany).toHaveBeenCalledTimes(1);
    expect(m.updateMany.mock.calls[0][0].where).toEqual({
      id: 'foreign',
      organizationId: 'org',
      deletedAt: null,
    });
  });

  it('404s a delete of a foreign or deleted signature', async () => {
    const { service } = signatures(0);
    await expect(service.deleteSignature('org', 'gone')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a new default still clears the old default', async () => {
    const { m, service } = signatures(1);
    await service.createOrUpdateSignature('org', { content: 'x', autoAdd: true });
    expect(m.create).toHaveBeenCalled();
    expect(m.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org', id: { not: 'new-id' } },
      data: { autoAdd: false },
    });
  });
});
