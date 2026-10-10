// The storage factory reads env at call time and would otherwise build a real
// client; the service only ever needs removeFile.
const removeFile = jest.fn().mockResolvedValue(undefined);
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({ removeFile }) },
}));

import { UsersService } from '@gitroom/nestjs-libraries/database/prisma/users/users.service';

// E2E-09-58: removeFile is implemented three times and was called nowhere, and
// media deletion is soft — so after someone exercised their right to erasure,
// every photo and video they had uploaded was still a working URL on the CDN.
// Postra is registered with the ICO (ZC223242).

const build = (
  media: { path: string; thumbnail: string | null; organizationId?: string }[],
  other: {
    pictures?: (string | null)[];
    logos?: (string | null)[];
    postImages?: (string | null)[];
    stillUsed?: string[];
  } = {}
) => {
  media = media.map((m) => ({ organizationId: 'org-1', ...m }));
  const used = (path: string) => (other.stillUsed ?? []).includes(path);
  const countBy = (field: string) =>
    jest.fn(async ({ where }: any) => {
      const clause = where.OR ? where.OR.map((o: any) => Object.values(o)[0]) : [where[field]];
      return clause.some((c: any) => used(typeof c === 'string' ? c : c.contains ?? c.equals)) ? 1 : 0;
    });
  const tx = {
    organization: { delete: jest.fn().mockResolvedValue({}) },
    user: { delete: jest.fn().mockResolvedValue({}) },
    userOrganization: { count: jest.fn().mockResolvedValue(1) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    userOrganization: {
      findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-1' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    media: { findMany: jest.fn().mockResolvedValue(media), count: countBy('path') },
    integration: {
      findMany: jest.fn().mockResolvedValue(
        (other.pictures ?? []).map((picture) => ({ picture }))
      ),
      count: countBy('picture'),
    },
    brandKit: {
      findMany: jest.fn().mockResolvedValue(
        (other.logos ?? []).map((logoPath) => ({ logoPath }))
      ),
      count: countBy('logoPath'),
    },
    post: {
      findMany: jest.fn().mockResolvedValue(
        (other.postImages ?? []).map((image) => ({ image }))
      ),
      count: countBy('image'),
    },
    $transaction: jest.fn(async (fn: any) => fn(tx)),
  };
  const service = new UsersService({} as any, {} as any, prisma as any);
  return { service, prisma, tx };
};

describe('deleting an account', () => {
  it('removes the files behind the media it deletes', async () => {
    const { service } = build([
      { path: 'https://cdn.example/2026/09/a.jpg', thumbnail: null },
      {
        path: 'https://cdn.example/2026/09/b.mp4',
        thumbnail: 'https://cdn.example/2026/09/b.jpg',
      },
    ]);

    await service.deleteAccount('user-1');

    expect(removeFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://cdn.example/2026/09/a.jpg',
      'https://cdn.example/2026/09/b.jpg',
      'https://cdn.example/2026/09/b.mp4',
    ]);
  });

  it('reads the media rows before they cascade away', async () => {
    const { service, prisma } = build([]);
    await service.deleteAccount('user-1');

    const mediaCall = prisma.media.findMany.mock.invocationCallOrder[0];
    const txCall = prisma.$transaction.mock.invocationCallOrder[0];
    expect(mediaCall).toBeLessThan(txCall);
  });

  it('deletes the rows first, so storage cannot roll back an erasure', async () => {
    const { service, tx } = build([
      { path: 'https://cdn.example/a.jpg', thumbnail: null },
    ]);

    await service.deleteAccount('user-1');

    expect(tx.user.delete.mock.invocationCallOrder[0]).toBeLessThan(
      removeFile.mock.invocationCallOrder[0]
    );
  });

  it('still reports success when the bucket refuses a file', async () => {
    removeFile.mockRejectedValueOnce(new Error('no such key'));
    const { service } = build([
      { path: 'https://cdn.example/a.jpg', thumbnail: null },
      { path: 'https://cdn.example/b.jpg', thumbnail: null },
    ]);

    await expect(service.deleteAccount('user-1')).resolves.toEqual({
      deleted: true,
    });
    expect(removeFile).toHaveBeenCalledTimes(2);
  });

  it('touches storage at all only when there was media', async () => {
    const { service } = build([]);
    await service.deleteAccount('user-1');
    expect(removeFile).not.toHaveBeenCalled();
  });
});

// 2026-10-10: the media rows were the only files collected. A deleted
// account's channel avatars (profile pictures copied into our bucket), its
// brand kit logo and the pictures in its posts that never went through the
// library (Auto Post, the agent) stayed public on the CDN: 11 objects from
// October had no row left pointing at them.
describe('deleting an account removes every file the organisation stored', () => {
  const CDN = 'https://cdn.example';
  const env = { ...process.env };
  beforeEach(() => {
    removeFile.mockClear();
    process.env.STORAGE_PROVIDER = 's3';
    process.env.NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY = CDN;
  });
  afterAll(() => {
    process.env = env;
  });

  it('includes channel avatars, the brand kit logo and post pictures', async () => {
    const { service } = build([{ path: `${CDN}/2026/10/m.jpg`, thumbnail: null }], {
      pictures: [`${CDN}/2026/10/avatar.jpg`, null],
      logos: [`${CDN}/2026/10/logo.png`],
      postImages: [
        JSON.stringify([
          { id: 'x', path: `${CDN}/2026/10/m.jpg` },
          { id: 'y', path: `${CDN}/2026/10/autopost.jpg` },
        ]),
        null,
      ],
    });

    await service.deleteAccount('user-1');

    expect(removeFile.mock.calls.map((c) => c[0]).sort()).toEqual([
      `${CDN}/2026/10/autopost.jpg`,
      `${CDN}/2026/10/avatar.jpg`,
      `${CDN}/2026/10/logo.png`,
      `${CDN}/2026/10/m.jpg`,
    ]);
  });

  it('never touches files that are not in our storage', async () => {
    const { service } = build([], {
      pictures: ['https://scontent.xx.fbcdn.net/v/avatar.jpg'],
      postImages: [JSON.stringify([{ path: 'https://feed.example/2026/10/a.jpg' }])],
    });

    await service.deleteAccount('user-1');

    expect(removeFile).not.toHaveBeenCalled();
  });

  it('keeps a file that something outside the organisation still uses', async () => {
    const { service } = build([], {
      pictures: [`${CDN}/2026/10/shared.jpg`, `${CDN}/2026/10/own.jpg`],
      stillUsed: [`${CDN}/2026/10/shared.jpg`],
    });

    await service.deleteAccount('user-1');

    expect(removeFile.mock.calls.map((c) => c[0])).toEqual([`${CDN}/2026/10/own.jpg`]);
  });

  it('collects them before the rows cascade away', async () => {
    const { service, prisma } = build([], { pictures: [`${CDN}/2026/10/a.jpg`] });
    await service.deleteAccount('user-1');

    const txCall = prisma.$transaction.mock.invocationCallOrder[0];
    for (const model of [prisma.integration, prisma.brandKit, prisma.post]) {
      expect(model.findMany.mock.invocationCallOrder[0]).toBeLessThan(txCall);
    }
  });
});

// E2E-09-66: the platform grants behind the deleted channels are revoked,
// read before the rows go and revoked only for organisations really deleted.
describe('deleting an account revokes platform grants', () => {
  it('collects before the delete and revokes after, for deleted organisations only', async () => {
    const { prisma, tx } = build([]);
    const grants = { collect: jest.fn().mockResolvedValue([{ providerIdentifier: 'facebook' }]), revokeUnused: jest.fn() };
    const service = new UsersService({} as any, {} as any, prisma as any, grants as any);

    await service.deleteAccount('user-1');

    expect(grants.collect).toHaveBeenCalledWith(['org-1']);
    expect(grants.collect.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    expect(grants.revokeUnused).toHaveBeenCalledWith([{ providerIdentifier: 'facebook' }]);
    expect(tx.user.delete.mock.invocationCallOrder[0]).toBeLessThan(grants.revokeUnused.mock.invocationCallOrder[0]);
  });

  it('revokes nothing for an organisation that gained a member meanwhile', async () => {
    const { prisma, tx } = build([]);
    tx.userOrganization.count.mockResolvedValue(2);
    const grants = { collect: jest.fn().mockResolvedValue([{ providerIdentifier: 'facebook' }]), revokeUnused: jest.fn() };
    await new UsersService({} as any, {} as any, prisma as any, grants as any).deleteAccount('user-1');
    expect(grants.revokeUnused).toHaveBeenCalledWith([]);
  });
});

// AUTH-1: the members were counted before the transaction. Someone accepting
// an invitation in between lost their membership, posts and channels with the
// org.
describe('deleting an account while someone joins the organisation', () => {
  it('keeps an organisation that gained a member, and its files', async () => {
    const { service, tx } = build([{ path: 'https://cdn.example/x.jpg', thumbnail: null }]);
    removeFile.mockClear();
    tx.userOrganization.count.mockResolvedValue(2);

    await service.deleteAccount('user-1');

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.organization.delete).not.toHaveBeenCalled();
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    expect(removeFile).not.toHaveBeenCalled();
  });
});
