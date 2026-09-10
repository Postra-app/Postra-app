import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';

const makeRepo = (rows: any[] = []) => {
  const calls: {
    create: any[];
    count: any[];
    findMany: any[];
    updateMany: any[];
  } = {
    create: [],
    count: [],
    findMany: [],
    updateMany: [],
  };
  const media = {
    updateMany: (args: any) => {
      calls.updateMany.push(args);
      return Promise.resolve({ count: args.where.id.in.length });
    },
    create: (args: any) => {
      calls.create.push(args);
      return Promise.resolve({ id: 'm1' });
    },
    count: (args: any) => {
      calls.count.push(args);
      return Promise.resolve(0);
    },
    findMany: (args: any) => {
      calls.findMany.push(args);
      return Promise.resolve(rows);
    },
  };
  const repository = new MediaRepository({ model: { media } } as any);
  return { repository, calls };
};

describe('saveFile records the type', () => {
  it('stores a video as a video', async () => {
    const { repository, calls } = makeRepo();
    await repository.saveFile('org-1', 'AbCdEfGhIj.mp4', '2026/09/10/AbCdEfGhIj.mp4');
    expect(calls.create[0].data.type).toBe('video');
  });

  it('stores everything else as an image', async () => {
    const { repository, calls } = makeRepo();
    await repository.saveFile('org-1', 'AbCdEfGhIj.jpg', '2026/09/10/AbCdEfGhIj.jpg');
    expect(calls.create[0].data.type).toBe('image');
  });
});

describe('getMedia filters where the pager can see it', () => {
  it('counts and lists through the same filter', async () => {
    const { repository, calls } = makeRepo();
    await repository.getMedia('org-1', 1, undefined, 'video');
    // The count drives the pager. Filtering the page after the query is what
    // used to give an empty video tab with several pages promised.
    expect(calls.count[0].where.OR).toEqual(calls.findMany[0].where.OR);
    expect(calls.count[0].where.OR).toBeDefined();
  });

  it('accepts rows written before the backfill by their extension', async () => {
    const { repository, calls } = makeRepo();
    await repository.getMedia('org-1', 1, undefined, 'video');
    expect(calls.findMany[0].where.OR).toEqual([
      { type: 'video' },
      { path: { endsWith: '.mp4', mode: 'insensitive' } },
    ]);
  });

  it('keeps those same rows out of the image list', async () => {
    const { repository, calls } = makeRepo();
    await repository.getMedia('org-1', 1, undefined, 'image');
    expect(calls.findMany[0].where.type).toEqual({ not: 'video' });
    expect(calls.findMany[0].where.NOT).toEqual({
      path: { endsWith: '.mp4', mode: 'insensitive' },
    });
  });

  it('adds no type filter when none was asked for', async () => {
    const { repository, calls } = makeRepo();
    await repository.getMedia('org-1', 1);
    expect(calls.findMany[0].where.OR).toBeUndefined();
    expect(calls.findMany[0].where.type).toBeUndefined();
  });

  it('returns the type so the reader does not have to guess', async () => {
    const { repository, calls } = makeRepo();
    await repository.getMedia('org-1', 1);
    expect(calls.findMany[0].select.type).toBe(true);
  });
});

describe('backfillMediaType', () => {
  const library = [
    { id: 'a', path: '2026/07/12/one.mp4' },
    { id: 'b', path: '2026/07/12/two.jpg' },
    { id: 'c', path: '2026/07/12/three.MP4' },
  ];

  it('reports the videos without touching anything on a dry run', async () => {
    const { repository, calls } = makeRepo(library);
    const report = await repository.backfillMediaType(false);
    expect(report.videos.map((v: any) => v.id)).toEqual(['a', 'c']);
    expect(report.scanned).toBe(3);
    expect(calls.updateMany).toHaveLength(0);
  });

  it('writes only those rows when applied', async () => {
    const { repository, calls } = makeRepo(library);
    await repository.backfillMediaType(true);
    expect(calls.updateMany).toHaveLength(1);
    expect(calls.updateMany[0].where.id.in).toEqual(['a', 'c']);
    expect(calls.updateMany[0].data).toEqual({ type: 'video' });
  });

  it('leaves rows already marked as video out of the scan', async () => {
    const { repository, calls } = makeRepo(library);
    await repository.backfillMediaType(false);
    expect(calls.findMany[0].where).toEqual({ type: { not: 'video' } });
  });

  it('writes nothing when there is nothing to fix', async () => {
    const { repository, calls } = makeRepo([{ id: 'b', path: 'two.jpg' }]);
    await repository.backfillMediaType(true);
    expect(calls.updateMany).toHaveLength(0);
  });
});
