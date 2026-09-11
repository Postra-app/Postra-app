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

const build = (media: { path: string; thumbnail: string | null }[]) => {
  const tx = {
    organization: { delete: jest.fn().mockResolvedValue({}) },
    user: { delete: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    userOrganization: {
      findMany: jest.fn().mockResolvedValue([{ organizationId: 'org-1' }]),
      count: jest.fn().mockResolvedValue(1),
    },
    media: { findMany: jest.fn().mockResolvedValue(media) },
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
